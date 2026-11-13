package app.freedomfi.sms

import android.content.Context
import android.provider.Telephony

/** One-off scan of messages already on the phone, to bring in recent history. */
object InboxScanner {
    fun scan(ctx: Context, days: Int): Int {
        val since = System.currentTimeMillis() - days.coerceIn(1, 365) * 86_400_000L
        var added = 0
        val cursor = ctx.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            "${Telephony.Sms.DATE} >= ?",
            arrayOf(since.toString()),
            "${Telephony.Sms.DATE} ASC"
        ) ?: return 0
        cursor.use { c ->
            val a = c.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val b = c.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val d = c.getColumnIndexOrThrow(Telephony.Sms.DATE)
            while (c.moveToNext()) {
                val sender = c.getString(a) ?: continue
                val body = c.getString(b) ?: continue
                if (SmsFilter.isFinancial(sender, body) && PendingStore.add(ctx, sender, body, c.getLong(d))) added++
            }
        }
        return added
    }
}
