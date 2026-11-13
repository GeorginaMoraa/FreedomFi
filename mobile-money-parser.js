/*
 * FreedomFi – mobile money & bank message parser
 *
 * Turns M-Pesa, Airtel Money, T-Kash and bank SMS alerts (and CSV statements)
 * into FreedomFi transactions: { name, amount, type, category, date, source, ref, key }.
 *
 * Pure functions, no DOM access, so it can be unit-tested with Node:
 *   node test-parser.js
 *
 * Message formats differ between providers and change over time. The parser is
 * deliberately tolerant (keyword + pattern based) rather than tied to one exact
 * template. Anything it cannot read confidently is flagged or skipped, never guessed.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FreedomParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---------- building blocks ----------
    const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
    const CUR = '(?:\\b(?:KES|KSHS?|SH|USD)|\\$)\\.?';
    const AMOUNT_RE = new RegExp(CUR + '\\s*' + NUM, 'i');
    const TRAILING_AMOUNT_RE = new RegExp(NUM + '\\s*(?:KES|KSHS?)\\b', 'i');

    const BALANCE_RE = new RegExp(
        '\\b(?:(?:new|avail(?:able)?|actual|ledger|current|closing|your)\\s+)*' +
        '(?:m-?pesa\\s+|airtel\\s*money\\s+|t-?kash\\s+|account\\s+|a\\/c\\s+|wallet\\s+)*' +
        'bal(?:ance)?\\.?\\s*(?:is|of|:|=|-)?\\s*(?:' + CUR + ')?\\s*' + NUM, 'ig');

    const FEE_RE = new RegExp(
        '\\b(?:transaction\\s+cost|trans(?:action)?\\.?\\s*fee|fee|charge[sd]?|commission|excise\\s+duty)' +
        '\\s*(?:is|of|:|,|-)?\\s*' + CUR + '\\s*' + NUM, 'ig');

    const LIMIT_RE = new RegExp(
        '(?:amount\\s+you\\s+can\\s+transact\\s+within\\s+the\\s+day\\s+is|daily\\s+limit(?:\\s+is)?|' +
        'remaining\\s+limit(?:\\s+is)?)\\s*(?:' + CUR + ')?\\s*' + NUM, 'ig');

    const CREDIT_WORDS = [
        'you have received', 'received', 'credited', 'credit alert', 'deposited', 'deposit of',
        'refund', 'reversal', 'reversed', 'salary', 'inward', 'sent you', 'cash in'
    ];
    const DEBIT_WORDS = [
        'debited', 'debit alert', 'withdrawn', 'withdraw', 'withdrawal', 'purchase', 'paid to', 'paid',
        'sent to', 'you have sent', 'transferred to', 'you have transferred', 'you bought', 'bought',
        'charged', 'payment of', 'payment to', 'spent', 'airtime', 'standing order', 'cash out', 'atm'
    ];

    const BANKS = [
        ['Equity', /\bequity\b/i], ['KCB', /\bkcb\b/i], ['Co-op Bank', /\bco-?op(?:erative)?\b/i],
        ['Absa', /\babsa\b/i], ['NCBA', /\bncba\b/i], ['Stanbic', /\bstanbic\b/i],
        ['Standard Chartered', /\bstanchart\b|\bstandard chartered\b/i], ['Family Bank', /\bfamily bank\b/i],
        ['DTB', /\bdtb\b|\bdiamond trust\b/i], ['I&M', /\bi&m\b|\bi and m\b/i], ['Sidian', /\bsidian\b/i],
        ['HF Group', /\bhf (?:group|bank)\b|\bhousing finance\b/i], ['National Bank', /\bnational bank\b/i],
        ['Ecobank', /\becobank\b/i], ['Gulf African', /\bgulf african\b/i], ['Bank of Africa', /\bbank of africa\b/i],
        ['Prime Bank', /\bprime bank\b/i], ['SBM', /\bsbm\b/i], ['Citi', /\bcitibank\b|\bciti\b/i],
        ['Faulu', /\bfaulu\b/i], ['Kingdom Bank', /\bkingdom bank\b/i], ['Spire Bank', /\bspire bank\b/i]
    ];

    // ---------- small helpers ----------
    function toNumber(s) {
        if (typeof s === 'number') return s;
        let t = String(s == null ? '' : s).trim();
        const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
        t = t.replace(/[^0-9.]/g, '');
        const n = parseFloat(t);
        if (isNaN(n)) return NaN;
        return neg ? -n : n;
    }

    // Strip anything that could be interpreted as markup and tidy whitespace.
    function sanitize(s, max) {
        let t = String(s == null ? '' : s).replace(/[<>"'`&\\]/g, ' ').replace(/\s+/g, ' ').trim();
        t = t.replace(/^[\s\-–:.,;]+|[\s\-–:.,;]+$/g, '');
        if (max && t.length > max) t = t.slice(0, max - 1).trim() + '…';
        return t;
    }

    function maskAll(text, re) {
        re.lastIndex = 0;
        return text.replace(re, ' ');
    }

    function pad(n) { return String(n).padStart(2, '0'); }
    function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

    function validYMD(y, m, d) {
        if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
        const dt = new Date(y, m - 1, d);
        return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    }

    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    // Kenyan convention: day first. A date that lands in the future is retried month-first.
    function parseDate(text, today) {
        const now = today ? new Date(today) : new Date();
        const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
        const fix = (y, a, b) => {
            // a = day, b = month (day-first)
            if (y < 100) y += 2000;
            let cand = validYMD(y, b, a) ? new Date(y, b - 1, a) : null;
            if (cand && cand >= limit && validYMD(y, a, b)) {
                const swapped = new Date(y, a - 1, b);
                if (swapped < limit) return iso(y, a, b);
            }
            if (cand) return iso(y, b, a);
            if (validYMD(y, a, b)) return iso(y, a, b);
            return null;
        };

        let m = text.match(/(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?!\d)/);
        if (m && validYMD(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);

        m = text.match(/(?:^|[^\d.])(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?!\d)/);
        if (m) { const r = fix(+m[3], +m[1], +m[2]); if (r) return r; }

        m = text.match(/(?:^|[^\d])(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})\.?,?[\s\-]+(\d{4}|\d{2})(?!\d)/);
        if (m) {
            const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
            let y = +m[3]; if (y < 100) y += 2000;
            if (mi >= 0 && validYMD(y, mi + 1, +m[1])) return iso(y, mi + 1, +m[1]);
        }
        return null;
    }

    function todayISO(today) {
        const d = today ? new Date(today) : new Date();
        return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }

    // ---------- provider / direction ----------
    function detectProvider(text) {
        if (/new\s+m-?pesa\s+balance/i.test(text) || /^\s*[A-Z0-9]{10}\s+confirmed/i.test(text)) return 'M-Pesa';
        if (/\bairtel\b/i.test(text)) return 'Airtel Money';
        if (/t-?kash|telkom/i.test(text)) return 'T-Kash';
        for (const [name, re] of BANKS) if (re.test(text)) return name;
        if (/m-?pesa|safaricom/i.test(text)) return 'M-Pesa';
        if (/\b(?:a\/c|acc(?:ount)?|bank)\b/i.test(text)) return 'Bank';
        return 'Other';
    }

    function firstIndex(lower, words) {
        let best = -1;
        for (const w of words) {
            const re = new RegExp('\\b' + w.replace(/\s+/g, '\\s+') + '\\b');
            const m = re.exec(lower);
            if (m && (best === -1 || m.index < best)) best = m.index;
        }
        return best;
    }

    function detectType(text) {
        const lower = text.toLowerCase();
        if (/you have received/.test(lower)) return 'income';
        const c = firstIndex(lower, CREDIT_WORDS);
        const d = firstIndex(lower, DEBIT_WORDS);
        if (c === -1 && d === -1) return null;
        if (c === -1) return 'expense';
        if (d === -1) return 'income';
        return c < d ? 'income' : 'expense';
    }

    function extractRef(text) {
        let m = text.match(/^\s*([A-Z0-9]{10})\s+confirmed/i);
        if (m && /\d/.test(m[1])) return m[1].toUpperCase();
        m = text.match(/\b(?:TID|Trans(?:action)?\s*ID|Txn\s*(?:ID|No)|Ref(?:erence)?(?:\s*(?:No|Number))?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9.\-]{5,})/i);
        if (m && /\d/.test(m[1])) return m[1].toUpperCase().replace(/[.\-]+$/, '');
        return null;
    }

    // ---------- counterparty ----------
    const STOP = '(?=\\s+(?:on|at|via|ref(?:erence)?|bal(?:ance)?|new|trans(?:action)?|tid|for|account|acc|a\\/c|using|kindly|dial|thank)\\b|\\s+\\+?\\d[\\d\\s*]{6,}|[.,;](?:\\s|$)|$)';

    function extractParty(text, type) {
        let m;
        if (type === 'income') {
            m = text.match(new RegExp('\\b(?:received|credited|deposit(?:ed)?|sent you)\\b.{0,100}?\\bfrom\\s+(.+?)' + STOP, 'i'));
            if (!m) m = text.match(new RegExp('\\bfrom\\s+(.+?)' + STOP, 'i'));
        } else {
            m = text.match(new RegExp('\\b(?:sent to|paid to|transferred to|transfer to|payment to|sent money to)\\s+(.+?)' + STOP, 'i'));
            // "You have sent KES 800.00 to PETER OTIENO ..."
            if (!m) m = text.match(new RegExp('\\b(?:sent|paid|transferred)\\s+(?:' + CUR + ')?\\s*[\\d,]+(?:\\.\\d+)?\\s+to\\s+(.+?)' + STOP, 'i'));
            if (!m) m = text.match(new RegExp('\\b(?:purchase|spent|paid|payment|debited)\\b.{0,100}?\\bat\\s+(?!\\d)(?:pos\\s+|web\\s+|ecom\\s+)?(.+?)' + STOP, 'i'));
        }
        return m ? sanitize(m[1], 50) : '';
    }

    function extractNarration(text) {
        const m = text.match(/(?:narration|description|details|particulars|remarks?)\s*[:\-]\s*(.+?)(?=\.\s|\s{2,}|$)/i);
        if (m) return sanitize(m[1], 50);
        // Bank style: "debited with KES 2,300 for NETFLIX on 03/11/2026"
        const f = text.match(new RegExp('\\bfor\\s+(?!(?:the|your|a|an)\\b)(.+?)' + STOP, 'i'));
        if (f && !/^\d/.test(f[1])) return sanitize(f[1], 50);
        return '';
    }

    // Short free-text sentence such as "Salary payment." that banks append after the date.
    function extractTrailingNote(text) {
        const parts = text.split(/\.\s+/).map(s => s.trim());
        for (const p of parts) {
            if (/^(?:salary|wages?|payroll|rent|refund|dividend|interest|bonus|commission)\b/i.test(p)) return sanitize(p, 50);
        }
        return '';
    }

    // ---------- categories ----------
    const EXPENSE_RULES = [
        ['Airtime & Data', /airtime|data bundle|bundles?\b|safaricom data|telkom|airtel (?:data|airtime)/i],
        ['Utilities', /kplc|kenya power|prepaid|water|zuku|dstv|gotv|startimes|safaricom home|faiba|wananchi|electric|nawasco|internet|wifi|fib(?:er|re)|gas\b|garbage/i],
        ['Savings & Loans', /m-?shwari|kcb m-?pesa|fuliza|loan|tala\b|branch\b|okash|saida|zenka|sacco|mmf|money market|chama|savings|ziidi|pension|repay/i],
        ['Health', /pharmacy|chemist|hospital|clinic|medical|dental|dentist|\blab\b|\bsha\b|nhif|health|doctor|optical|mediheal|aga khan|mater\b/i],
        ['Education', /school|universit|college|helb|tuition|academy|kindergarten|books?\b|exam/i],
        ['Insurance', /insurance|jubilee|britam|\bcic\b|madison|old mutual|resolution|assurance|sanlam|\buap\b|minet|geminia|\bapa\b/i],
        ['Housing', /\brent\b|landlord|apartment|estate|mortgage|housing|service charge|caretaker/i],
        ['Transport', /uber|bolt\b|little cab|fuel|petrol|total ?energies|rubis|shell\b|vivo energy|oilibya|matatu|bus\b|\bsgr\b|kenya railways|parking|toll\b|airways|jambojet|flight|taxi|boda|\bcab\b|transport|fare\b/i],
        ['Food & Dining', /naivas|quickmart|carrefour|tuskys|chandarana|cleanshelf|supermarket|grocer|butcher|kfc|java\b|chicken inn|pizza|restaurant|cafe|coffee|hotel|bakery|glovo|eats\b|kitchen|eatery|mboga|market|foods?\b|lunch|dinner|breakfast|liquor|wines?\b|\bbar\b|delivery/i],
        ['Entertainment', /netflix|showmax|spotify|youtube|sportpesa|betika|betway|odibets|mozzart|\bbet\b|casino|cinema|imax|movie|gaming|playstation|ticket|club\b|concert/i],
        ['Personal', /salon|barber|kinyozi|spa\b|beauty|cosmetic|gym\b|laundry|dry clean/i],
        ['Shopping', /jumia|kilimall|amazon|shop\b|store\b|mall\b|fashion|boutique|electronics|cloth|shoe|hardware|mart\b|superstore|decathlon|woolworths/i]
    ];

    const INCOME_RULES = [
        ['Salary', /salary|payroll|wages?\b|stipend|remuneration/i],
        ['Freelance', /invoice|freelance|consult|gig\b/i],
        ['Investments', /dividend|interest|\bmmf\b|bond\b|t-?bill|stock|\bnse\b|\bcds\b|ziidi/i]
    ];

    function categorize(haystack, type, kind) {
        const h = String(haystack || '');
        if (type === 'expense') {
            if (kind === 'fee') return 'Fees & Charges';
            if (kind === 'withdraw') return 'Cash Withdrawal';
            if (kind === 'airtime') return 'Airtime & Data';
            for (const [cat, re] of EXPENSE_RULES) if (re.test(h)) return cat;
            return 'Other';
        }
        for (const [cat, re] of INCOME_RULES) if (re.test(h)) return cat;
        return 'Other Income';
    }

    function looksLikeFee(details) {
        return /\b(?:withdraw(?:al)?|send money|pay ?bill|buy goods|customer transfer|b2c|transfer|transaction)?\s*charges?\b|\btransaction cost\b|\bexcise duty\b|\bfee\b/i.test(details);
    }

    // ---------- keys ----------
    function makeKey(source, ref, date, type, amount, name, suffix) {
        const base = ref
            ? source + '|' + ref
            : [source, date, type, Number(amount).toFixed(2), String(name).toLowerCase()].join('|');
        return suffix ? base + '|' + suffix : base;
    }

    // ---------- single message ----------
    function parseMessage(raw, opts) {
        opts = opts || {};
        const text = sanitizeInput(raw);
        if (!text) return { ok: false, reason: 'Empty message' };

        const lower = text.toLowerCase();
        const ref = extractRef(text);
        const hasConfirm = /\bconfirmed\b/i.test(text) || !!ref;

        if (/fuliza/i.test(text) && /outstanding|accessed|limit|interest/i.test(text) && !/\bsent to\b|\bpaid to\b/i.test(lower)) {
            return { ok: false, reason: 'Fuliza notice – the payment itself arrives as its own message' };
        }
        if (/\b(?:failed|declined|insufficient|unsuccessful|cancelled|canceled)\b/i.test(text) && !/\bconfirmed\b/i.test(text)) {
            return { ok: false, reason: 'Not a completed transaction' };
        }
        if (/\b(?:otp|one[- ]time|verification code|your pin|passcode)\b/i.test(text)) {
            return { ok: false, reason: 'Security code message' };
        }

        // Pull out numbers that must not be mistaken for the main amount.
        const balances = [];
        BALANCE_RE.lastIndex = 0;
        let bm;
        while ((bm = BALANCE_RE.exec(text))) balances.push(toNumber(bm[1]));
        let work = maskAll(text, BALANCE_RE);
        work = maskAll(work, LIMIT_RE);

        let fee = 0;
        FEE_RE.lastIndex = 0;
        let fm;
        while ((fm = FEE_RE.exec(work))) fee += toNumber(fm[1]);
        const feeMasked = maskAll(work, FEE_RE);

        let amount = NaN;
        let m = feeMasked.match(AMOUNT_RE);
        if (m) amount = toNumber(m[1]);
        else {
            m = feeMasked.match(TRAILING_AMOUNT_RE);
            if (m) amount = toNumber(m[1]);
        }

        const provider = detectProvider(text);
        const source = provider === 'Other' ? (opts.source || 'Other') : provider;
        const date = parseDate(text, opts.today) || todayISO(opts.today);

        // Only a fee in the message (e.g. "your account has been charged KES 50")
        if ((!amount || isNaN(amount)) && fee > 0) {
            const name = source + ' charge';
            return {
                ok: true,
                txs: [{
                    name: sanitize(name, 60), amount: round2(fee), type: 'expense', category: 'Fees & Charges',
                    date, source, ref, key: makeKey(source, ref, date, 'expense', fee, name, ref ? 'fee' : ''),
                    confidence: hasConfirm ? 'high' : 'medium', raw: text
                }],
                balance: balances[0]
            };
        }
        if (!amount || isNaN(amount)) return { ok: false, reason: 'No amount found' };

        const type = detectType(text);
        if (!type) return { ok: false, reason: 'Could not tell whether money came in or went out' };

        const promo = /\b(?:win|offer|bonus|promo(?:tion)?|click|apply now|qualify|congratulations|eligible|you can borrow|get up to|enjoy)\b|dial\s*\*/i.test(text);
        const looksReal = hasConfirm || balances.length > 0 ||
            /\b(?:debited|credited|withdrawn|deposited|purchase|a\/c|account|acc)\b/i.test(text);
        if (promo && !hasConfirm && balances.length === 0) return { ok: false, reason: 'Looks like a promotional message' };
        if (!looksReal) return { ok: false, reason: 'Does not look like a transaction alert' };

        let kind = '';
        let party = extractParty(text, type);
        let name;

        if (type === 'expense' && /\bwithdraw(?:al|n)?\b/i.test(text) && !/sent to|paid to/i.test(lower)) {
            kind = 'withdraw';
            const ag = text.match(/\bfrom\s+(?:\d+\s*[-–]\s*)?(.+?)(?=\s+new\b|\s+m-?pesa|\s+bal|\s+trans|\.\s|$)/i);
            const agent = ag ? sanitize(ag[1], 40) : '';
            name = agent && !/^\d+$/.test(agent) ? 'Cash withdrawal – ' + agent : 'Cash withdrawal';
            party = agent;
        } else if (type === 'expense' && /\bairtime\b/i.test(text)) {
            kind = 'airtime';
            name = 'Airtime purchase';
        } else if (type === 'income') {
            const nar = extractNarration(text) || extractTrailingNote(text);
            name = party ? 'Received from ' + party : (nar || 'Incoming payment');
        } else {
            const nar = extractNarration(text);
            const verb = /paid to|buy goods|purchase|\bat\b/i.test(text) && !/sent to/i.test(lower) ? 'Paid to ' : 'Sent to ';
            name = party ? verb + party : (nar ? 'Payment – ' + nar : source + ' payment');
        }

        const narration = extractNarration(text) || extractTrailingNote(text);
        let category = categorize([party, narration, name].join(' '), type, kind);
        // Nothing matched on the merchant/purpose: try the whole message before settling on "Other".
        if (category === 'Other' || category === 'Other Income') {
            const wide = categorize(text.replace(/\b(?:avail(?:able)?|new|actual)\s+bal(?:ance)?\b.*$/i, ''), type, kind);
            if (wide !== 'Other' && wide !== 'Other Income') category = wide;
        }
        const txs = [{
            name: sanitize(name, 60), amount: round2(amount), type, category, date, source, ref,
            key: makeKey(source, ref, date, type, amount, name),
            confidence: hasConfirm ? 'high' : (balances.length ? 'high' : 'medium'),
            raw: text
        }];

        if (fee > 0 && type === 'expense') {
            const fname = source + ' transaction fee';
            txs.push({
                name: fname, amount: round2(fee), type: 'expense', category: 'Fees & Charges', date, source, ref,
                key: makeKey(source, ref, date, 'expense', fee, fname, 'fee'),
                confidence: txs[0].confidence, raw: text
            });
        }
        return { ok: true, txs, balance: balances[0] };
    }

    function round2(n) { return Math.round(n * 100) / 100; }

    function sanitizeInput(raw) {
        return String(raw == null ? '' : raw)
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ---------- many messages ----------
    function splitMessages(text) {
        const norm = String(text || '').replace(/\r/g, '').trim();
        if (!norm) return [];
        const out = [];
        const refSplit = /(?=(?:^|\s)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\s+[Cc]onfirmed)/;
        norm.split(/\n\s*\n+/).forEach(block => {
            block.split(refSplit).forEach(part => {
                const lines = part.split('\n').map(l => l.trim()).filter(Boolean);
                const withAmount = lines.filter(l => AMOUNT_RE.test(l) || TRAILING_AMOUNT_RE.test(l));
                if (lines.length > 1 && withAmount.length === lines.length) lines.forEach(l => out.push(l));
                else if (lines.length) out.push(lines.join(' '));
            });
        });
        return out.filter(s => s.trim());
    }

    function parseMany(text, opts) {
        const txs = [];
        const skipped = [];
        const seen = new Set();
        const messages = splitMessages(text);
        messages.forEach(msg => {
            const r = parseMessage(msg, opts);
            if (!r.ok) { skipped.push({ raw: msg.slice(0, 160), reason: r.reason }); return; }
            r.txs.forEach(t => {
                if (seen.has(t.key)) { skipped.push({ raw: msg.slice(0, 160), reason: 'Duplicate in this batch' }); return; }
                seen.add(t.key);
                txs.push(t);
            });
        });
        return { txs, skipped, total: messages.length };
    }

    // ---------- CSV statements ----------
    function splitCSVLine(line, delim) {
        const cells = [];
        let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (q) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') q = false;
                else cur += ch;
            } else if (ch === '"') q = true;
            else if (ch === delim) { cells.push(cur); cur = ''; }
            else cur += ch;
        }
        cells.push(cur);
        return cells.map(c => c.trim());
    }

    function detectDelimiter(lines) {
        const sample = lines.slice(0, 8).join('\n');
        const counts = { ',': (sample.match(/,/g) || []).length, ';': (sample.match(/;/g) || []).length, '\t': (sample.match(/\t/g) || []).length };
        return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    }

    const COL = {
        date: /date|time|completion/i,
        desc: /detail|description|narration|particular|remark|transaction\s*type|^type$/i,
        paidIn: /paid\s*in|credit|deposit|money\s*in|\bcr\b/i,
        out: /withdraw|debit|paid\s*out|money\s*out|\bdr\b/i,
        amount: /^amount$|^value$/i,
        ref: /receipt|reference|^ref|trans(?:action)?\s*(?:id|no)/i,
        status: /status/i,
        balance: /balance/i
    };

    function parseStatementCSV(text, opts) {
        opts = opts || {};
        const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
        if (lines.length < 2) return { txs: [], skipped: [], total: 0, error: 'File looks empty' };
        const delim = detectDelimiter(lines);

        let headerIdx = -1, cols = {};
        for (let i = 0; i < Math.min(lines.length, 25); i++) {
            const cells = splitCSVLine(lines[i], delim);
            const map = {};
            cells.forEach((c, idx) => {
                if (COL.balance.test(c)) { map.balance = idx; return; }
                if (COL.ref.test(c) && map.ref === undefined) map.ref = idx;
                else if (COL.status.test(c)) map.status = idx;
                else if (COL.paidIn.test(c) && map.paidIn === undefined) map.paidIn = idx;
                else if (COL.out.test(c) && map.out === undefined) map.out = idx;
                else if (COL.amount.test(c) && map.amount === undefined) map.amount = idx;
                else if (COL.date.test(c) && map.date === undefined) map.date = idx;
                else if (COL.desc.test(c) && map.desc === undefined) map.desc = idx;
            });
            const hasMoney = map.paidIn !== undefined || map.out !== undefined || map.amount !== undefined;
            if (map.date !== undefined && hasMoney) { headerIdx = i; cols = map; break; }
        }
        if (headerIdx === -1) {
            return { txs: [], skipped: [], total: 0, error: 'Could not find date and amount columns. Expected headers such as Date, Details, Paid In / Withdrawn (or Credit / Debit, or Amount).' };
        }

        const source = cols.ref !== undefined && /receipt/i.test(splitCSVLine(lines[headerIdx], delim)[cols.ref])
            ? 'M-Pesa' : (opts.source || 'Statement');
        const txs = [], skipped = [], seen = new Set();
        let total = 0;

        for (let i = headerIdx + 1; i < lines.length; i++) {
            const c = splitCSVLine(lines[i], delim);
            if (c.length < 2) continue;
            total++;
            const date = parseDate(String(c[cols.date] || ''), opts.today);
            const details = sanitize(cols.desc !== undefined ? c[cols.desc] : '', 80);
            const ref = cols.ref !== undefined ? sanitize(c[cols.ref], 30).toUpperCase() || null : null;

            if (!date) { skipped.push({ raw: lines[i].slice(0, 120), reason: 'No readable date' }); continue; }
            if (cols.status !== undefined && /fail|cancel|declin|reject/i.test(c[cols.status] || '')) {
                skipped.push({ raw: lines[i].slice(0, 120), reason: 'Failed transaction' }); continue;
            }

            let amount = NaN, type = null;
            const inV = cols.paidIn !== undefined ? toNumber(c[cols.paidIn]) : NaN;
            const outV = cols.out !== undefined ? toNumber(c[cols.out]) : NaN;
            if (!isNaN(inV) && Math.abs(inV) > 0) { amount = Math.abs(inV); type = 'income'; }
            else if (!isNaN(outV) && Math.abs(outV) > 0) { amount = Math.abs(outV); type = 'expense'; }
            else if (cols.amount !== undefined) {
                const v = toNumber(c[cols.amount]);
                if (!isNaN(v) && v !== 0) {
                    amount = Math.abs(v);
                    const byText = detectType(details);
                    type = v < 0 ? 'expense' : (byText || 'income');
                }
            }
            if (!amount || isNaN(amount) || !type) { skipped.push({ raw: lines[i].slice(0, 120), reason: 'No amount' }); continue; }

            const kind = type === 'expense' && looksLikeFee(details) ? 'fee'
                : type === 'expense' && /\bwithdraw/i.test(details) && !/charge/i.test(details) ? 'withdraw'
                : type === 'expense' && /airtime/i.test(details) ? 'airtime' : '';
            const name = details || (type === 'income' ? 'Incoming payment' : 'Payment');
            const key = makeKey(source, ref, date, type, amount, name);
            if (seen.has(key)) { skipped.push({ raw: lines[i].slice(0, 120), reason: 'Duplicate row' }); continue; }
            seen.add(key);
            txs.push({
                name: sanitize(name, 60), amount: round2(amount), type, category: categorize(details, type, kind),
                date, source, ref, key, confidence: 'high', raw: lines[i].slice(0, 200)
            });
        }
        return { txs, skipped, total };
    }

    return { parseMessage, parseMany, parseStatementCSV, splitMessages, parseDate, categorize, sanitize, detectProvider };
});
