# LifeOS local server

## Start LifeOS

Install Node.js, open a terminal in this folder, and run:

```powershell
npm start
```

If Node.js was just installed and `npm` is not recognized, restart VS Code so its terminal picks up the updated PATH.

Keep that terminal open while using LifeOS. Open the `http://localhost:3000` address printed by the server on this computer. To use another device on the same Wi-Fi, open the matching `http://<computer-ip>:3000` address printed by the server. If Windows Firewall asks, allow Node.js on your **Private networks** only.

The first time each browser connects, enter the access passcode printed in the server terminal, then create an account or log in. The access passcode is saved in that browser; the account session lasts up to 30 days while the server is running. Usernames may contain letters, numbers, and underscores; passwords must be at least 10 characters. Each account has separate tasks, habits, goals, and notes. Passwords are stored as salted scrypt hashes; account data is stored as JSON files in a LifeOS folder under the operating system's local application-data directory. The folder is separate from the app folder and survives server restarts. Stop the server with Ctrl+C. Restart it with `npm start`; the access passcode stays the same, but users must log in again after a restart.

When the first account is created, it claims any existing shared server data. If its data is empty, LifeOS can also offer to copy the current browser's saved tasks, habits, goals, and notes into that account. Other accounts start with their own empty data. You can still move an account's data using **Download backup** and **Import backup**. Dark-mode preference remains local to each browser.

## Organize your dashboard

Tasks can have a high, medium, or low priority, plus an optional project and category. Use the search box to find tasks, habits, goals, or notes; the priority, project, and category filters narrow tasks. The arrow controls reorder tasks, habits, goals, and dashboard sections. Choose **Customize dashboard** from the top-right menu to hide or show sections and arrange the dashboard. These preferences and task details sync with the account and are included in version 3 backups. Earlier backups remain importable.

## Task reminders

When adding or editing a task, enable **Set a reminder** and choose the local date and time. Scheduled reminders also appear in the Reminders dashboard section, where they can be edited or removed. LifeOS checks reminders while its page is open and displays an in-app alert when one is due; the server or browser cannot deliver it while the app is closed. Reminder times and sent status sync with the account and are included in version 3 backups. Older backups remain importable without reminders.

## Account settings

Choose **Settings** from the top-right menu to change your username or password, set the browser's light/dark theme, or delete your account. Username and password changes require the current password. Password changes log out other sessions. Account deletion requires the current password, typing the username, and a final confirmation; it permanently removes that account's saved data. Download a backup first if you want to keep your data. Account management is available only when connected to the server; local browser mode only supports changing the theme.

The access passcode protects the API, but traffic is plain HTTP; account passwords and data are not encrypted in transit. Use this server only on a trusted private network, do not use it on public or school Wi-Fi, do not forward its port to the internet, and keep the passcode private. JSON backup download and import remain available.
