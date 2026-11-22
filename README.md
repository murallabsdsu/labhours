# Lab Hours Log

A small website where lab student workers log daily hours (date, start, end, where, work done, output). Hours are calculated from the times. Each student sees only their own entries. The supervisor sees everyone, approves or returns entries, adds entries, and downloads CSV backups. Approved entries are locked.

Hosting: GitHub Pages (free). Login and data: Firebase Authentication and Firestore (free Spark plan, no card needed at this size).

## One-time setup (about 15 minutes)

1. Go to https://console.firebase.google.com, click **Add project**, name it `lab-hours`, and turn Google Analytics off.
2. **Build > Authentication > Get started > Sign-in method > Email/Password > Enable > Save.**
3. **Build > Firestore Database > Create database.** Choose a region near you and **Production mode**.
4. Firestore **Rules** tab: delete everything, paste the full contents of `firestore.rules` from this repo, and click **Publish**.
5. **Project settings (gear) > Your apps > Web (</>)**, register an app, and copy the `firebaseConfig` values into `config.js` (apiKey, authDomain, projectId, appId). These values are not secret. The rules protect the data.
6. **Authentication > Settings > Authorized domains > Add domain:** `murallabsdsu.github.io`.
7. GitHub repo **Settings > Pages**: Source = **Deploy from a branch**, Branch = `main`, folder `/ (root)`, Save. The site appears at `https://murallabsdsu.github.io/labhours/`.

## Make yourself the owner

1. Open the site, choose **Create an account**, and sign up with the supervisor email.
2. Firebase console > **Authentication > Users**: copy your **User UID**.
3. Firestore > **Start collection** `admins` > Document ID = your UID > add any field (for example `ok` = true) > Save.
4. Reload the site. You now see **Dashboard, Accounts, Settings**. Only documents you add in `admins` become owners. Nobody can add themselves.

## Students

Students open the site, create an account with their email, and wait. In **Accounts** you check the email, confirm the name, and click **Approve**. After that they can log hours.

## Daily use

- Dashboard: filter by Status = Waiting for approval, then Approve or Return with a note.
- Dashboard > Download CSV gives the month. Settings > Download everything gives a full backup. Do this monthly.
- Remove a student's access in Accounts. Their old entries stay.

## What is protected

- Students can only read and write their own entries. Enforced by `firestore.rules`, not by the page.
- Students cannot approve, change approved entries, or set their own hours or timestamps.
- Created-at time is set by the server, so late entries are flagged reliably.
- Only owners listed in `admins` can see all data.

## Keep it public or private?

GitHub Pages on a free plan needs a public repo. That is safe: the repo holds code only. Names, emails and hours live in Firebase behind login. Never commit exports or CSV files to this repo.

## Settings (supervisor)

- **Places:** add or remove the Where choices.
- **Extra fields on every entry:** add text, number or pick-from-list fields; mark them required; edit names and choices; remove them. Removed fields are hidden, and old entries keep their values.
- **Student profile fields:** Student ID, phone, program, start date, weekly limit are the defaults. Add, rename or remove fields. They are editable per student under **Accounts > Edit profile**, together with private notes only the supervisor sees.
- **Dashboard:** each student's tile has one button, **Approve all waiting**, which approves everything that student has logged, across all dates.

## Monthly emails (free, runs on GitHub Actions)

- The **19th**: each approved student gets a reminder to update hours (3 days before the 22nd).
- The **22nd**: each supervisor in `admins` gets one summary with a student-by-student table and a button to the Dashboard.
- Sent at 15:00 UTC (9 AM Central standard time). The hours cycle is the 23rd to the 22nd.

One-time setup:

1. Firebase console > Project settings (gear) > **Service accounts** > **Generate new private key**. A JSON file downloads. Never commit it.
2. GitHub repo > **Settings > Secrets and variables > Actions > New repository secret**. Add:
   - `FIREBASE_SERVICE_ACCOUNT`: paste the whole JSON file contents.
   - `GMAIL_USER`: the Gmail address that sends the mail.
   - `GMAIL_APP_PASSWORD`: a Google **App password** (turn on 2-Step Verification for that Gmail, then https://myaccount.google.com/apppasswords).
3. Test: GitHub repo > **Actions > Monthly emails > Run workflow**, pick `admin`, leave **dry run** ticked, run, and read the log. Run again with dry run unticked to send a real email.

Notes: GitHub pauses scheduled workflows after 60 days with no repo activity, so re-enable it in the Actions tab if emails stop. Scheduled runs can start a few minutes late.
