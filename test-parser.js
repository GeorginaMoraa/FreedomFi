// Run with: node test-parser.js
const P = require('./mobile-money-parser.js');
const today = '2026-11-13';
let pass = 0, fail = 0;

function check(name, cond, extra) {
    if (cond) pass++;
    else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
function one(msg) { return P.parseMessage(msg, { today }); }

// ---- M-Pesa ----
let r = one('QKJ7H2X9AB Confirmed. Ksh1,500.00 sent to JOHN KAMAU 0712345678 on 12/11/26 at 2:15 PM. New M-PESA balance is Ksh3,250.50. Transaction cost, Ksh23.00. Amount you can transact within the day is 496,500.00.');
check('mpesa send ok', r.ok, r);
check('mpesa send amount', r.txs[0].amount === 1500, r.txs[0]);
check('mpesa send type', r.txs[0].type === 'expense');
check('mpesa send name', /John Kamau/i.test(r.txs[0].name), r.txs[0].name);
check('mpesa send date', r.txs[0].date === '2026-11-12', r.txs[0].date);
check('mpesa send ref', r.txs[0].ref === 'QKJ7H2X9AB');
check('mpesa fee row', r.txs.length === 2 && r.txs[1].amount === 23 && r.txs[1].category === 'Fees & Charges', r.txs);
check('mpesa balance ignored', r.txs.every(t => t.amount !== 3250.5 && t.amount !== 496500));

r = one('QKL1A2B3CD Confirmed. You have received Ksh25,000.00 from ACME LTD 0722000111 on 1/11/26 at 9:00 AM. New M-PESA balance is Ksh28,250.50.');
check('mpesa receive', r.ok && r.txs[0].type === 'income' && r.txs[0].amount === 25000, r);
check('mpesa receive name', /Acme Ltd/i.test(r.txs[0].name), r.txs[0].name);
check('mpesa receive date', r.txs[0].date === '2026-11-01', r.txs[0].date);

r = one('QKM4E5F6GH Confirmed. Ksh350.00 paid to NAIVAS SUPERMARKET. on 10/11/26 at 6:30 PM.New M-PESA balance is Ksh2,000.00. Transaction cost, Ksh0.00.');
check('mpesa till', r.ok && r.txs[0].amount === 350 && r.txs[0].category === 'Food & Dining', r);
check('mpesa zero fee skipped', r.txs.length === 1, r.txs);

r = one('QKN7I8J9KL Confirmed.Ksh2,000.00 paid to KENYA POWER. on 5/11/26 at 8:12 AM. New M-PESA balance is Ksh500.00. Transaction cost, Ksh0.00.');
check('mpesa kplc utilities', r.ok && r.txs[0].category === 'Utilities', r);

r = one('QKO1M2N3OP Confirmed. Ksh5,000.00 withdrawn from 123456 - MAMA MBOGA AGENT on 9/11/26 at 1:00 PM. New M-PESA balance is Ksh1,000.00. Transaction cost, Ksh29.00.');
check('mpesa withdraw', r.ok && r.txs[0].category === 'Cash Withdrawal' && r.txs[0].amount === 5000, r);
check('mpesa withdraw fee', r.txs.length === 2 && r.txs[1].amount === 29, r.txs);

r = one('QKP4Q5R6ST Confirmed. Ksh100.00 sent to Safaricom for airtime on 8/11/26 at 7:00 AM. New M-PESA balance is Ksh900.00.');
check('mpesa airtime', r.ok && r.txs[0].category === 'Airtime & Data' && r.txs[0].amount === 100, r);

r = one('QKQ7U8V9WX Confirmed. Ksh1,200.00 sent to KCB M-PESA account on 7/11/26. New M-PESA balance is Ksh4,000.00. Transaction cost, Ksh15.00.');
check('mpesa kcb savings', r.ok && r.txs[0].amount === 1200, r);

// Fuliza informational notice must not become a transaction
r = one('QKR1Y2Z3AB Confirmed. Fuliza M-PESA amount is Ksh500.00. Interest charged Ksh5.00. Total Fuliza M-PESA outstanding amount is Ksh505.00 due on 10/12/26.');
check('fuliza skipped', !r.ok, r);

// ---- Airtel Money ----
r = one('Airtel Money: TID: MP261105.1234.A56789. You have received KES 3,000.00 from JANE WANJIRU 0733123456 on 05/11/2026 14:20. Your new balance is KES 4,200.00.');
check('airtel receive', r.ok && r.txs[0].type === 'income' && r.txs[0].amount === 3000, r);
check('airtel provider', r.txs[0].source === 'Airtel Money', r.txs[0].source);
check('airtel ref', r.txs[0].ref && r.txs[0].ref.startsWith('MP261105'), r.txs[0].ref);
check('airtel date', r.txs[0].date === '2026-11-05', r.txs[0].date);

r = one('Airtel Money: TID: MP261106.0900.B12345. You have sent KES 800.00 to PETER OTIENO 0733987654 on 06/11/2026 09:00. Fee KES 11.00. Your new balance is KES 3,389.00.');
check('airtel send', r.ok && r.txs[0].type === 'expense' && r.txs[0].amount === 800, r);
check('airtel send name', /Peter Otieno/i.test(r.txs[0].name), r.txs[0].name);
check('airtel send fee', r.txs.length === 2 && r.txs[1].amount === 11, r.txs);

// ---- Banks ----
r = one('Equity Bank: Your A/C XXXXXX1234 has been debited with KES 4,500.00 on 11/11/2026 at POS NAIVAS WESTLANDS. Avail Bal: KES 22,100.45.');
check('equity debit', r.ok && r.txs[0].type === 'expense' && r.txs[0].amount === 4500, r);
check('equity merchant name', /Naivas/i.test(r.txs[0].name), r.txs[0].name);
check('equity provider', r.txs[0].source === 'Equity', r.txs[0].source);
check('equity bal ignored', r.txs.every(t => t.amount !== 22100.45));

r = one('KCB: Acc 332****89 credited with KES 60,000.00 on 28/10/2026. Salary payment. Available balance KES 75,320.10.');
check('kcb salary', r.ok && r.txs[0].type === 'income' && r.txs[0].amount === 60000 && r.txs[0].category === 'Salary', r);
check('kcb provider', r.txs[0].source === 'KCB', r.txs[0].source);

r = one('Co-op Bank: KES 12,000.00 withdrawn from your account at ATM on 09/11/2026. Bal KES 8,000.00.');
check('coop atm', r.ok && r.txs[0].type === 'expense' && r.txs[0].category === 'Cash Withdrawal', r);

r = one('ABSA: Your account has been debited with KES 2,300.00 for NETFLIX on 03/11/2026. Available balance is KES 9,000.00.');
check('absa netflix', r.ok && r.txs[0].category === 'Entertainment', r);

r = one('NCBA: Dear customer, a deposit of KES 15,000.00 was made to your account on 02/11/2026. Ref: FT26306ABCDE. Balance KES 30,000.00.');
check('ncba deposit', r.ok && r.txs[0].type === 'income' && r.txs[0].amount === 15000, r);
check('ncba ref', r.txs[0].ref === 'FT26306ABCDE', r.txs[0].ref);

r = one('Stanbic: USD 50.00 purchase at AMAZON on 04/11/2026. Avail bal USD 1,000.00');
check('usd purchase', r.ok && r.txs[0].amount === 50 && r.txs[0].category === 'Shopping', r);

// ---- Rejects ----
check('otp rejected', !one('Your Equity OTP is 123456. Do not share. Valid for 5 minutes.').ok);
check('promo rejected', !one('Congratulations! You qualify for a loan of up to KES 50,000. Dial *334# to apply now.').ok);
check('failed rejected', !one('Transaction of KES 500 failed due to insufficient funds. Your balance is KES 20.').ok);
check('empty rejected', !one('').ok);
check('no amount rejected', !one('Hello from your bank, thanks for banking with us').ok);

// ---- Batch ----
const batch = [
    'QKJ7H2X9AB Confirmed. Ksh1,500.00 sent to JOHN KAMAU 0712345678 on 12/11/26 at 2:15 PM. New M-PESA balance is Ksh3,250.50. Transaction cost, Ksh23.00.',
    'QKL1A2B3CD Confirmed. You have received Ksh25,000.00 from ACME LTD on 1/11/26 at 9:00 AM. New M-PESA balance is Ksh28,250.50.',
    'QKJ7H2X9AB Confirmed. Ksh1,500.00 sent to JOHN KAMAU 0712345678 on 12/11/26 at 2:15 PM. New M-PESA balance is Ksh3,250.50. Transaction cost, Ksh23.00.'
].join('\n\n');
let b = P.parseMany(batch, { today });
check('batch count', b.txs.length === 3, b.txs.map(t => t.name));
check('batch dup skipped', b.skipped.some(s => /Duplicate/.test(s.reason)), b.skipped);

// Messages pasted back to back with no blank line
const glued = 'QKJ7H2X9AB Confirmed. Ksh100.00 paid to SHOP A. on 1/11/26 at 1:00 PM. New M-PESA balance is Ksh900.00. QKJ7H2X9AC Confirmed. Ksh200.00 paid to SHOP B. on 2/11/26 at 1:00 PM. New M-PESA balance is Ksh700.00.';
b = P.parseMany(glued, { today });
check('glued split', b.txs.length === 2 && b.txs[0].amount === 100 && b.txs[1].amount === 200, b.txs);

// ---- Date handling ----
check('date day-first', P.parseDate('on 12/11/26', today) === '2026-11-12');
check('date iso', P.parseDate('2026-03-04', today) === '2026-03-04');
check('date words', P.parseDate('on 5 Nov 2026', today) === '2026-11-05');
check('date future swap', P.parseDate('on 11/12/2026', today) === '2026-11-12' || P.parseDate('on 11/12/2026', today) === '2026-12-11');
check('date none', P.parseDate('no date here', today) === null);

// ---- Safety ----
r = one('QKT1A2B3CD Confirmed. Ksh100.00 sent to <img src=x onerror=alert(1)> 0712345678 on 1/11/26.');
check('no markup in name', r.ok && !/[<>"']/.test(r.txs[0].name), r.ok && r.txs[0].name);

// ---- CSV: M-Pesa statement ----
const mpesaCsv = [
    'Receipt No,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance',
    'QKA1,2026-11-10 10:00:00,Customer Transfer to - 0712345678 JOHN,COMPLETED,,1500.00,3000.00',
    'QKA2,2026-11-09 09:00:00,Funds received from - 0722000111 ACME LTD,COMPLETED,25000.00,,28000.00',
    'QKA3,2026-11-08 08:00:00,Pay Bill to 888880 KPLC PREPAID,FAILED,,500.00,3000.00',
    'QKA4,2026-11-07 07:00:00,Customer Transfer Fee,COMPLETED,,23.00,2977.00'
].join('\n');
let c = P.parseStatementCSV(mpesaCsv, { today });
check('csv count', c.txs.length === 3, c);
check('csv failed skipped', c.skipped.some(s => /Failed/.test(s.reason)), c.skipped);
check('csv in/out', c.txs[0].type === 'expense' && c.txs[1].type === 'income');
check('csv fee category', c.txs[2].category === 'Fees & Charges', c.txs[2]);
check('csv source', c.txs[0].source === 'M-Pesa', c.txs[0].source);

// ---- CSV: bank statement with Debit/Credit ----
const bankCsv = [
    'Account Statement',
    'Name: Someone',
    'Date;Narration;Debit;Credit;Balance',
    '01/11/2026;SALARY ACME LTD;;80,000.00;90,000.00',
    '02/11/2026;POS QUICKMART;3,200.00;;86,800.00'
].join('\n');
c = P.parseStatementCSV(bankCsv, { today, source: 'Bank' });
check('bank csv parsed', c.txs.length === 2, c);
check('bank csv salary', c.txs[0].type === 'income' && c.txs[0].category === 'Salary' && c.txs[0].amount === 80000, c.txs[0]);
check('bank csv food', c.txs[1].type === 'expense' && c.txs[1].category === 'Food & Dining', c.txs[1]);

// ---- CSV: single signed Amount column ----
const signedCsv = 'Date,Description,Amount\n2026-11-01,Rent payment,-25000\n2026-11-02,Refund from shop,1000';
c = P.parseStatementCSV(signedCsv, { today });
check('signed csv', c.txs.length === 2 && c.txs[0].type === 'expense' && c.txs[1].type === 'income', c);

check('bad csv error', !!P.parseStatementCSV('foo,bar\n1,2', { today }).error);

// ---- parseAuto: pasted statements, PDF-copied lines, DR/CR column ----
const tabTable = 'Receipt No.\tCompletion Time\tDetails\tStatus\tPaid In\tWithdrawn\tBalance\nQKA1ABC123\t2026-11-10 10:00:00\tCustomer Transfer to - 0712345678 JOHN\tCOMPLETED\t\t-1,500.00\t3,000.00\nQKA2ABC123\t2026-11-09 09:00:00\tFunds received from ACME\tCOMPLETED\t25,000.00\t\t28,000.00';
let a = P.parseAuto(tabTable, { today });
check('auto tab table', a.txs.length === 2 && a.txs[0].type === 'expense' && a.txs[1].type === 'income', a);

const pdfLines = 'QKA1ABC123 2026-11-10 10:00:00 Customer Transfer to - 0712345678 JOHN KAMAU COMPLETED 0.00 -1,500.00 3,000.00\nQKA2ABC123 2026-11-09 09:00:00 Funds received from - 0722000111 ACME COMPLETED 25,000.00 0.00 28,000.00\nQKA3ABC123 2026-11-08 08:00:00 Pay Bill to 888880 - KPLC PREPAID Acc. 123 COMPLETED 0.00 -500.00 2,500.00\nQKA4ABC123 2026-11-07 07:00:00 Pay Bill to 1 FAILED 0.00 -50.00 2,500.00';
a = P.parseAuto(pdfLines, { today });
check('auto pdf lines count', a.txs.length === 3, a);
check('auto pdf lines types', a.txs[0].type === 'expense' && a.txs[0].amount === 1500 && a.txs[1].type === 'income' && a.txs[1].amount === 25000, a.txs);
check('auto pdf lines utilities', a.txs[2].category === 'Utilities', a.txs[2]);
check('auto pdf failed skipped', a.skipped.some(x => /Failed/.test(x.reason)), a.skipped);
check('auto pdf phone not amount', a.txs.every(t => t.amount < 100000));

// SMS must still be treated as SMS, not as statement lines
a = P.parseAuto('QKJ7H2X9AB Confirmed. Ksh1,500.00 sent to JOHN KAMAU 0712345678 on 12/11/26 at 2:15 PM. New M-PESA balance is Ksh3,250.50. Transaction cost, Ksh23.00.', { today });
check('auto keeps sms', a.kind === 'sms' && a.txs.length === 2 && a.txs[0].amount === 1500, a);

c = P.parseStatementCSV('Date,Description,Amount,Type,Balance\n2026-11-10,POS QUICKMART,3200.00,DR,5000\n2026-11-11,SALARY,80000.00,CR,85000', { today });
check('dr/cr column', c.txs[0].type === 'expense' && c.txs[1].type === 'income', c.txs);

a = P.parseAuto('hello this is not a statement', { today });
check('auto nothing', a.txs.length === 0 && a.kind === 'none');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
