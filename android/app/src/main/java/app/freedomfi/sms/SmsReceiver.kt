package app.freedomfi.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return

        // Long messages arrive in several parts; stitch them back together per sender.
        val bySender = LinkedHashMap<String, StringBuilder>()
        var ts = 0L
        for (p in parts) {
            val from = p.originatingAddress ?: continue
            bySender.getOrPut(from) { StringBuilder() }.append(p.messageBody ?: "")
            ts = maxOf(ts, p.timestampMillis)
        }
        if (ts == 0L) ts = System.currentTimeMillis()

        var added = false
        for ((sender, text) in bySender) {
            val body = text.toString()
            if (SmsFilter.isFinancial(sender, body) && PendingStore.add(context, sender, body, ts)) added = true
        }
        if (added) PendingStore.notifyChanged()
    }
}
