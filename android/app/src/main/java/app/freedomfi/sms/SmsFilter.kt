package app.freedomfi.sms

/**
 * Decides whether an SMS is a money alert worth passing to FreedomFi.
 * Anything that fails this check is dropped immediately and never stored,
 * so personal conversations are never read or kept.
 */
object SmsFilter {
    private val amount = Regex(
        """(?i)\b(?:ksh(?:s)?|kes|usd)\.?\s*[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d+)?\s*(?:ksh(?:s)?|kes)\b"""
    )
    private val keywords = Regex(
        """(?i)confirmed|debited|credited|deposit|withdraw|received|sent to|paid to|purchase|balance|\bbal\b|transaction|airtel money|m-?pesa|a/c|account"""
    )
    private val security = Regex("""(?i)\botp\b|one[- ]time|verification code|passcode|\bpin\b""")

    fun isFinancial(sender: String?, body: String): Boolean {
        val s = sender?.trim().orEmpty()
        if (s.isEmpty() || body.isBlank()) return false
        // Messages from ordinary phone numbers are people, not banks or MPESA.
        val digitsOnly = s.removePrefix("+").all { it.isDigit() }
        if (digitsOnly && s.length > 6) return false
        if (security.containsMatchIn(body)) return false
        return amount.containsMatchIn(body) && keywords.containsMatchIn(body)
    }
}
