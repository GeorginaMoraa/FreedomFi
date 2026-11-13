# FreedomFi for Android (automatic M-Pesa / Airtel Money / bank capture)

A thin Android wrapper around the FreedomFi website. It adds one thing the web can't do:
**read money-alert SMS in the background** and hand them to FreedomFi, which adds them as income
and expenses automatically.

## How it works

1. `SmsReceiver` wakes up on every incoming SMS.
2. `SmsFilter` keeps only money alerts (named sender such as MPESA or a bank, a Ksh/KES amount,
   money words; OTPs and messages from ordinary phone numbers are discarded and never stored).
3. Kept messages wait in `PendingStore`.
4. FreedomFi (running in the WebView) reads them through `window.FreedomAndroid`, parses them with
   `mobile-money-parser.js`, adds the transactions, then acknowledges them so they are deleted from the queue.

All data stays on the phone. The app has the INTERNET permission only so the WebView can load web fonts and open links.

## Build

1. Install [Android Studio](https://developer.android.com/studio).
2. **File → Open** and choose this `android/` folder. Let Gradle sync.
3. Connect a phone (USB debugging on) and press **Run**, or **Build → Build APK(s)** and copy the APK to your phone.
4. Open the app, sign in or create your FreedomFi account, go to **Auto-Import**, tap
   **Enable automatic capture** and allow SMS access. It then scans the last 90 days once.

`index.html` and `mobile-money-parser.js` are copied from the repo root into the app on every build
(see `syncWeb` in `app/build.gradle.kts`), so edit those files in the root, not here.

## Notes

- Install it by sideloading the APK. Google Play restricts apps that read SMS to default-SMS-app
  use cases unless an exception is approved, so a Play Store release needs a permissions declaration.
- The app keeps its own FreedomFi data, separate from the website (a browser and an app never share storage). Use whichever you prefer as your main one; there is no import-from-backup button yet.
- Some phones (Xiaomi, Tecno, Infinix, Samsung battery savers) stop background apps. If messages only
  appear after opening the app, set FreedomFi to **Unrestricted** battery use.
- Messages are only captured while the app is installed with SMS permission. Opening the app syncs anything queued.
