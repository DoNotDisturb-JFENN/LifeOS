const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const APP_DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_SIZE = 1024 * 1024;
const DATA_DIR = process.env.LIFEOS_DATA_DIR || getDataDirectory();
const DATA_FILE = path.join(DATA_DIR, "lifeos.json");
const TOKEN_FILE = path.join(DATA_DIR, "access-token");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ACCOUNT_DATA_DIR = path.join(DATA_DIR, "accounts");
const sessions = new Map();
const authAttempts = new Map();
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
};

function getDataDirectory() {
    if (process.env.LOCALAPPDATA) {
        return path.join(process.env.LOCALAPPDATA, "LifeOS");
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", "LifeOS");
    }
    return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "LifeOS");
}

function defaultData() {
    return {
        tasks: [],
        events: [],
        habits: [],
        completedHabits: [],
        goals: [],
        notes: "",
        dashboard: {
            order: ["tasks", "reminders", "habits", "goals", "notes", "calendar", "upcomingEvents", "statistics"],
            visible: ["tasks", "reminders", "habits", "goals", "notes", "calendar", "upcomingEvents", "statistics"]
        }
    };
}

function readUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function writeUsers(users) {
    writeJsonFile(USERS_FILE, users);
}

function isStringArray(value) {
    return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isValidTask(task) {
    return typeof task === "string" ||
        (task &&
            typeof task === "object" &&
            typeof task.text === "string" &&
            task.text.trim().length > 0 &&
            task.text.length <= 500 &&
            ["high", "medium", "low"].includes(task.priority) &&
            typeof task.project === "string" &&
            task.project.length <= 60 &&
            typeof task.category === "string" &&
            task.category.length <= 40 &&
            (task.reminderAt === undefined || task.reminderAt === null ||
                (typeof task.reminderAt === "string" && Number.isFinite(Date.parse(task.reminderAt)))) &&
            (task.reminderNotifiedAt === undefined || task.reminderNotifiedAt === null ||
                (typeof task.reminderNotifiedAt === "string" &&
                    Number.isFinite(Date.parse(task.reminderNotifiedAt)))) &&
            (!task.reminderNotifiedAt || task.reminderAt));
}

function isValidEvent(event) {
    return event &&
        typeof event === "object" &&
        typeof event.id === "string" &&
        event.id.length > 0 &&
        event.id.length <= 100 &&
        typeof event.title === "string" &&
        event.title.trim().length > 0 &&
        event.title.length <= 150 &&
        ["Assignment", "Test", "Project", "Event"].includes(event.type) &&
        typeof event.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(event.date) &&
        Number.isFinite(Date.parse(`${event.date}T00:00:00Z`)) &&
        new Date(`${event.date}T00:00:00Z`).toISOString().slice(0, 10) === event.date &&
        typeof event.time === "string" &&
        (event.time === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) &&
        typeof event.description === "string" &&
        event.description.length <= 1000;
}

function isValidDashboard(value) {
    const legacySections = ["tasks", "habits", "goals", "notes", "statistics"];
    const sections = [...legacySections, "reminders"];
    const currentSections = [...sections, "calendar", "upcomingEvents"];
    const isValidOrder = order => {
        const validSets = [legacySections, sections, currentSections];
        return validSets.some(keys =>
            order.length === keys.length &&
            new Set(order).size === keys.length &&
            order.every(section => keys.includes(section))
        );
    };
    return value &&
        Array.isArray(value.order) &&
        isValidOrder(value.order) &&
        Array.isArray(value.visible) &&
        value.visible.length > 0 &&
        new Set(value.visible).size === value.visible.length &&
        value.visible.every(section => value.order.includes(section));
}

function isValidData(value) {
    return value &&
        Array.isArray(value.tasks) &&
        value.tasks.every(isValidTask) &&
        (value.events === undefined ||
            (Array.isArray(value.events) && value.events.every(isValidEvent))) &&
        isStringArray(value.habits) &&
        isStringArray(value.completedHabits) &&
        value.completedHabits.every(habit => value.habits.includes(habit)) &&
        Array.isArray(value.goals) &&
        value.goals.every(goal =>
            goal &&
            typeof goal.name === "string" &&
            goal.name.trim().length > 0 &&
            Number.isInteger(goal.progress) &&
            goal.progress >= 0 &&
            goal.progress <= 100
        ) &&
        typeof value.notes === "string" &&
        (value.dashboard === undefined || isValidDashboard(value.dashboard));
}

function readData() {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeData(data) {
    writeJsonFile(DATA_FILE, data);
}

function writeJsonFile(file, data) {
    const temporaryFile = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryFile, file);
}

function userDataFile(userId) {
    return path.join(ACCOUNT_DATA_DIR, `${userId}.json`);
}

function readUserData(userId) {
    const file = userDataFile(userId);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : defaultData();
}

function writeUserData(userId, data) {
    writeJsonFile(userDataFile(userId), data);
}

function getSessionId(request) {
    const sessionCookie = (request.headers.cookie || "").split(";")
        .map(item => item.trim())
        .find(item => item.startsWith("lifeos_session="));
    if (!sessionCookie) return null;
    return decodeURIComponent(sessionCookie.slice("lifeos_session=".length));
}

function getSessionUser(request) {
    const sessionId = getSessionId(request);
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(sessionId);
        return null;
    }
    return readUsers().users.find(user => user.id === session.userId) || null;
}

function setSessionCookie(response, sessionId) {
    response.setHeader(
        "Set-Cookie",
        `lifeos_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`
    );
}

function createSession(response, user) {
    const sessionId = crypto.randomBytes(32).toString("base64url");
    sessions.set(sessionId, { userId: user.id, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    setSessionCookie(response, sessionId);
    return { id: user.id, username: user.username };
}

function verifyPassword(password, user) {
    const actual = crypto.scryptSync(password, user.salt, 64);
    const expected = Buffer.from(user.passwordHash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validUsername(value) {
    return typeof value === "string" && /^[A-Za-z0-9_]{3,32}$/.test(value);
}

function validPassword(value) {
    return typeof value === "string" && value.length >= 10 && value.length <= 256;
}

function sendJson(response, status, value, headers = {}) {
    response.writeHead(status, {
        "Content-Type": MIME_TYPES[".json"],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers
    });
    response.end(JSON.stringify(value));
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        request.on("data", chunk => {
            if (tooLarge) return;
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                tooLarge = true;
                reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
                request.resume();
                return;
            }
            chunks.push(chunk);
        });
        request.on("end", () => {
            if (tooLarge) return;
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
            }
        });
        request.on("error", reject);
    });
}

function requestHostIsLocal(request) {
    const hostHeader = request.headers.host;
    if (!hostHeader) return false;
    try {
        const host = new URL(`http://${hostHeader}`).hostname.toLowerCase();
        const allowedHosts = new Set(["localhost", "127.0.0.1", "::1", os.hostname().toLowerCase()]);
        for (const interfaces of Object.values(os.networkInterfaces())) {
            for (const network of interfaces || []) {
                allowedHosts.add(network.address.toLowerCase());
            }
        }
        return allowedHosts.has(host);
    } catch {
        return false;
    }
}

function serveStatic(request, response, pathname) {
    let requestedPath;
    try {
        requestedPath = decodeURIComponent(pathname);
    } catch {
        response.writeHead(400).end("Bad request");
        return;
    }

    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    if (!["index.html", "style.css", "script.js"].includes(relativePath)) {
        response.writeHead(404).end("Not found");
        return;
    }
    const filePath = path.resolve(APP_DIR, relativePath);
    if (!filePath.startsWith(`${APP_DIR}${path.sep}`)) {
        response.writeHead(404).end("Not found");
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            response.writeHead(error.code === "ENOENT" ? 404 : 500).end(
                error.code === "ENOENT" ? "Not found" : "Could not read app file"
            );
            return;
        }
        response.writeHead(200, {
            "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer"
        });
        if (request.method === "HEAD") {
            response.end();
        } else {
            response.end(content);
        }
    });
}

function isEmpty(data) {
    return data.tasks.length === 0 &&
        (!data.events || data.events.length === 0) &&
        data.habits.length === 0 &&
        data.completedHabits.length === 0 &&
        data.goals.length === 0 &&
        data.notes.length === 0;
}

function isRateLimited(request) {
    const address = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recentAttempts = (authAttempts.get(address) || []).filter(time => now - time < 60000);
    if (recentAttempts.length >= 10) {
        authAttempts.set(address, recentAttempts);
        return true;
    }
    recentAttempts.push(now);
    authAttempts.set(address, recentAttempts);
    return false;
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ACCOUNT_DATA_DIR, { recursive: true });
if (!fs.existsSync(TOKEN_FILE)) {
    fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 });
}
if (!fs.existsSync(DATA_FILE)) {
    writeData(defaultData());
}
if (!fs.existsSync(USERS_FILE)) {
    writeUsers({ users: [], legacyClaimed: false });
}
const accessToken = fs.readFileSync(TOKEN_FILE, "utf8").trim();
if (!accessToken) throw new Error(`Access token file is empty: ${TOKEN_FILE}`);
if (!isValidData(readData())) throw new Error(`LifeOS data file is invalid: ${DATA_FILE}`);
const initialUsers = readUsers();
if (!Array.isArray(initialUsers.users) || typeof initialUsers.legacyClaimed !== "boolean") {
    throw new Error(`LifeOS accounts file is invalid: ${USERS_FILE}`);
}

const server = http.createServer(async (request, response) => {
    if (!requestHostIsLocal(request)) {
        response.writeHead(403).end("Requests are only accepted from this computer or its local network.");
        return;
    }

    let pathname;
    try {
        pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
        response.writeHead(400).end("Bad request");
        return;
    }

    if (pathname.startsWith("/api/")) {
        if (request.headers["x-lifeos-token"] !== accessToken) {
            sendJson(response, 403, { error: "A valid LifeOS access passcode is required." });
            return;
        }

        try {
            if (pathname === "/api/auth/status" && request.method === "GET") {
                const user = getSessionUser(request);
                sendJson(response, 200, {
                    authenticated: Boolean(user),
                    usersExist: readUsers().users.length > 0,
                    user: user ? { id: user.id, username: user.username } : null
                });
                return;
            }

            if (pathname === "/api/auth/signup" && request.method === "POST") {
                if (isRateLimited(request)) {
                    sendJson(response, 429, { error: "Too many account attempts. Wait a minute and try again." });
                    return;
                }
                const body = await readRequestBody(request);
                if (!body || typeof body !== "object" || Array.isArray(body)) {
                    sendJson(response, 400, { error: "Enter a username and password." });
                    return;
                }
                const { username, password } = body;
                if (!validUsername(username)) {
                    sendJson(response, 400, { error: "Use a 3–32 character username with letters, numbers, or underscores." });
                    return;
                }
                if (!validPassword(password)) {
                    sendJson(response, 400, { error: "Password must be between 10 and 256 characters." });
                    return;
                }

                const users = readUsers();
                const normalizedUsername = username.toLowerCase();
                if (users.users.some(user => user.username.toLowerCase() === normalizedUsername)) {
                    sendJson(response, 409, { error: "That username is already in use." });
                    return;
                }

                const salt = crypto.randomBytes(16).toString("hex");
                const newUser = {
                    id: crypto.randomUUID(),
                    username,
                    salt,
                    passwordHash: crypto.scryptSync(password, salt, 64).toString("hex")
                };
                const seedData = users.users.length === 0 && !users.legacyClaimed
                    ? readData()
                    : defaultData();
                writeUserData(newUser.id, seedData);
                users.users.push(newUser);
                users.legacyClaimed = true;
                writeUsers(users);
                const user = createSession(response, newUser);
                sendJson(response, 201, {
                    user,
                    data: seedData,
                    isEmpty: isEmpty(seedData)
                });
                return;
            }

            if (pathname === "/api/auth/login" && request.method === "POST") {
                if (isRateLimited(request)) {
                    sendJson(response, 429, { error: "Too many account attempts. Wait a minute and try again." });
                    return;
                }
                const body = await readRequestBody(request);
                if (!body || typeof body !== "object" || Array.isArray(body)) {
                    sendJson(response, 400, { error: "Enter a username and password." });
                    return;
                }
                const { username, password } = body;
                if (typeof username !== "string" || typeof password !== "string") {
                    sendJson(response, 400, { error: "Enter your username and password." });
                    return;
                }
                const user = readUsers().users.find(
                    item => item.username.toLowerCase() === username.toLowerCase()
                );
                const dummyUser = {
                    salt: "0".repeat(32),
                    passwordHash: "0".repeat(128)
                };
                if (!validPassword(password) ||
                    !verifyPassword(password, user || dummyUser) ||
                    !user) {
                    sendJson(response, 401, { error: "Username or password is incorrect." });
                    return;
                }
                const sessionUser = createSession(response, user);
                const data = readUserData(user.id);
                sendJson(response, 200, {
                    user: sessionUser,
                    data,
                    isEmpty: isEmpty(data)
                });
                return;
            }

            if (pathname === "/api/auth/logout" && request.method === "POST") {
                const cookie = (request.headers.cookie || "").split(";")
                    .map(item => item.trim())
                    .find(item => item.startsWith("lifeos_session="));
                if (cookie) {
                    sessions.delete(decodeURIComponent(cookie.slice("lifeos_session=".length)));
                }
                sendJson(response, 200, { ok: true }, {
                    "Set-Cookie": "lifeos_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
                });
                return;
            }

            const user = getSessionUser(request);
            if (!user) {
                sendJson(response, 401, { error: "Log in to access this account's LifeOS data." });
                return;
            }

            if (pathname === "/api/auth/update" && request.method === "POST") {
                if (isRateLimited(request)) {
                    sendJson(response, 429, { error: "Too many account attempts. Wait a minute and try again." });
                    return;
                }
                const body = await readRequestBody(request);
                if (!body || typeof body !== "object" || Array.isArray(body) ||
                    typeof body.currentPassword !== "string" ||
                    !validPassword(body.currentPassword)) {
                    sendJson(response, 400, { error: "Enter your current password." });
                    return;
                }
                if (!verifyPassword(body.currentPassword, user)) {
                    sendJson(response, 401, { error: "Current password is incorrect." });
                    return;
                }

                const changingUsername = Object.hasOwn(body, "username");
                const changingPassword = Object.hasOwn(body, "newPassword");
                if (!changingUsername && !changingPassword) {
                    sendJson(response, 400, { error: "Choose a username or password to change." });
                    return;
                }
                if (changingUsername && !validUsername(body.username)) {
                    sendJson(response, 400, { error: "Use a 3–32 character username with letters, numbers, or underscores." });
                    return;
                }
                if (changingPassword && !validPassword(body.newPassword)) {
                    sendJson(response, 400, { error: "Password must be between 10 and 256 characters." });
                    return;
                }

                const users = readUsers();
                if (changingUsername && users.users.some(item =>
                    item.id !== user.id && item.username.toLowerCase() === body.username.toLowerCase()
                )) {
                    sendJson(response, 409, { error: "That username is already in use." });
                    return;
                }
                const updatedUser = users.users.find(item => item.id === user.id);
                if (!updatedUser) {
                    sendJson(response, 401, { error: "This account no longer exists." });
                    return;
                }
                if (changingUsername) updatedUser.username = body.username;
                if (changingPassword) {
                    updatedUser.salt = crypto.randomBytes(16).toString("hex");
                    updatedUser.passwordHash = crypto.scryptSync(body.newPassword, updatedUser.salt, 64).toString("hex");
                }
                writeUsers(users);

                if (changingPassword) {
                    const currentSessionId = getSessionId(request);
                    for (const [sessionId, session] of sessions) {
                        if (session.userId === user.id && sessionId !== currentSessionId) {
                            sessions.delete(sessionId);
                        }
                    }
                }
                sendJson(response, 200, {
                    user: { id: updatedUser.id, username: updatedUser.username }
                });
                return;
            }

            if (pathname === "/api/auth/delete" && request.method === "POST") {
                if (isRateLimited(request)) {
                    sendJson(response, 429, { error: "Too many account attempts. Wait a minute and try again." });
                    return;
                }
                const body = await readRequestBody(request);
                if (!body || typeof body !== "object" || Array.isArray(body) ||
                    typeof body.password !== "string" ||
                    typeof body.confirmUsername !== "string") {
                    sendJson(response, 400, { error: "Confirm your username and enter your current password." });
                    return;
                }
                if (body.confirmUsername !== user.username) {
                    sendJson(response, 400, { error: "The confirmation username does not match." });
                    return;
                }
                if (!validPassword(body.password) || !verifyPassword(body.password, user)) {
                    sendJson(response, 401, { error: "Current password is incorrect." });
                    return;
                }

                const users = readUsers();
                users.users = users.users.filter(item => item.id !== user.id);
                writeUsers(users);
                for (const [sessionId, session] of sessions) {
                    if (session.userId === user.id) sessions.delete(sessionId);
                }
                try {
                    fs.unlinkSync(userDataFile(user.id));
                } catch (error) {
                    if (error.code !== "ENOENT") {
                        sendJson(response, 500, {
                            error: "Your account was deleted, but its saved data file could not be removed. Ask the server owner to remove the unused account data."
                        }, {
                            "Set-Cookie": "lifeos_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
                        });
                        return;
                    }
                }
                sendJson(response, 200, { ok: true }, {
                    "Set-Cookie": "lifeos_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
                });
                return;
            }

            if (pathname === "/api/data" && request.method === "GET") {
                const data = readUserData(user.id);
                sendJson(response, 200, { data, isEmpty: isEmpty(data) });
                return;
            }

            if (pathname === "/api/data" && request.method === "PATCH") {
                const patch = await readRequestBody(request);
                const current = readUserData(user.id);
                const updated = { ...current, ...patch };
                if (
                    !patch ||
                    typeof patch !== "object" ||
                    Array.isArray(patch) ||
                    Object.keys(patch).some(key => !["tasks", "events", "habits", "completedHabits", "goals", "notes", "dashboard"].includes(key)) ||
                    !isValidData(updated)
                ) {
                    sendJson(response, 400, { error: "Invalid LifeOS data update." });
                    return;
                }
                writeUserData(user.id, updated);
                sendJson(response, 200, { data: updated });
                return;
            }

            if (pathname === "/api/data" && request.method === "PUT") {
                const incoming = await readRequestBody(request);
                if (!isValidData(incoming)) {
                    sendJson(response, 400, { error: "Invalid LifeOS backup data." });
                    return;
                }
                writeUserData(user.id, incoming);
                sendJson(response, 200, { data: incoming });
                return;
            }

            if (pathname === "/api/migrate" && request.method === "POST") {
                const incoming = await readRequestBody(request);
                if (!isValidData(incoming)) {
                    sendJson(response, 400, { error: "Invalid browser data migration." });
                    return;
                }
                const current = readUserData(user.id);
                if (!isEmpty(current)) {
                    sendJson(response, 409, { error: "Account data already exists; migration was not applied.", data: current });
                    return;
                }
                writeUserData(user.id, incoming);
                sendJson(response, 200, { data: incoming });
                return;
            }

            sendJson(response, 404, { error: "API endpoint not found." });
        } catch (error) {
            if (response.headersSent || response.destroyed) return;
            sendJson(response, error.status || 500, {
                error: error.status ? error.message : "The LifeOS server could not complete the request."
            });
        }
        return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
        return;
    }
    serveStatic(request, response, pathname);
});

server.listen(PORT, "0.0.0.0", () => {
    const addresses = new Set(["http://localhost:" + PORT]);
    for (const interfaces of Object.values(os.networkInterfaces())) {
        for (const network of interfaces || []) {
            if (network.family === "IPv4" && !network.internal) {
                addresses.add(`http://${network.address}:${PORT}`);
            }
        }
    }
    console.log(`LifeOS is running:\n${[...addresses].map(address => `  ${address}`).join("\n")}`);
    console.log(`Access passcode: ${accessToken}`);
    console.log(`Data file: ${DATA_FILE}`);
    console.log("Use only on a trusted local network. Press Ctrl+C to stop.");
});

server.on("error", error => {
    console.error("LifeOS server failed to start:", error.message);
    process.exitCode = 1;
});
