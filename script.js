const $ = id => document.getElementById(id);
const tasksContainer = $("tasks-container");
const addTaskTrigger = $("add-task-trigger");
const addTaskContainer = $("add-task-container");
const addTaskInput = $("add-task-input");
const habitsForm = $("habits-form");
const addHabitTrigger = $("add-habit-trigger");
const addHabitContainer = $("add-habit-container");
const addHabitInput = $("add-habit-input");
const goalsContainer = $("goals-container");
const addGoalTrigger = $("add-goal-trigger");
const addGoalContainer = $("add-goal-container");
const addGoalInput = $("add-goal-input");
const dateDisplay = $("date-display");
const clockDisplay = $("clock-display");
const backupStatus = $("backup-status");
const notesInput = $("notes-input");
const themeToggle = $("theme-toggle");
const dashboardGrid = $("dashboard-grid");
const globalSearch = $("global-search");
const taskPriorityFilter = $("priority-filter");
const taskProjectFilter = $("project-filter");
const taskCategoryFilter = $("category-filter");
const dashboardSections = [
    { key: "tasks", id: "tasks-div", label: "Tasks" },
    { key: "reminders", id: "reminders-div", label: "Reminders" },
    { key: "habits", id: "habits-div", label: "Habits" },
    { key: "goals", id: "goals-div", label: "Goals" },
    { key: "notes", id: "notes-div", label: "Notes" },
    { key: "statistics", id: "statistics-section", label: "Statistics" }
];
const defaultDashboard = {
    order: dashboardSections.map(section => section.key),
    visible: dashboardSections.map(section => section.key)
};
const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
});
const clockFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
});

let tasks = [];
let habits = [];
let completedHabits = [];
let goals = [];
let dashboard = defaultDashboard;
let activeUser = null;
const localFileMode = location.protocol === "file:";
let accessToken = localStorage.getItem("lifeosAccessToken");
let pendingWrites = Promise.resolve();
let resolveAccessToken;

async function apiRequest(path, options = {}) {
    const send = () => fetch(path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options.headers,
            ...(accessToken ? { "X-LifeOS-Token": accessToken } : {})
        }
    });

    if (!accessToken) {
        accessToken = await requestAccessToken();
        localStorage.setItem("lifeosAccessToken", accessToken);
    }

    let response = await send();
    if (response.status === 403) {
        const result = await response.json();
        accessToken = null;
        localStorage.removeItem("lifeosAccessToken");
        $("auth-message").textContent = result.error;
        accessToken = await requestAccessToken();
        localStorage.setItem("lifeosAccessToken", accessToken);
        response = await send();
    }

    const result = await response.json();
    if (response.status === 403) {
        $("auth-panel").hidden = false;
        $("app-content").hidden = true;
        $("server-access-form").hidden = false;
        $("account-panel").hidden = true;
        $("auth-message").textContent = result.error;
        $("server-access-token").focus();
    }
    if (!response.ok) throw new Error(result.error || `LifeOS server error (${response.status}).`);
    return result;
}

function requestAccessToken() {
    const form = $("server-access-form");
    const input = $("server-access-token");
    $("auth-panel").hidden = false;
    $("app-content").hidden = true;
    $("account-panel").hidden = true;
    form.hidden = false;
    $("auth-message").textContent = "Enter the server passcode printed in the server terminal.";
    input.focus();
    return new Promise(resolve => {
        resolveAccessToken = resolve;
    });
}

function saveData(patch) {
    if (localFileMode) {
        for (const [key, value] of Object.entries(patch)) {
            localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
        }
        return;
    }

    const savedPatch = JSON.stringify(patch);
    pendingWrites = pendingWrites
        .then(() => apiRequest("/api/data", { method: "PATCH", body: savedPatch }))
        .then(() => {
            backupStatus.textContent = "All changes saved.";
        })
        .catch(error => {
            backupStatus.textContent = `Could not save changes: ${error.message}`;
        });
}

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    $("settings-theme").value = theme;
    localStorage.setItem("theme", theme);
}

function updateDateTime() {
    const now = new Date();
    dateDisplay.dateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);
    dateDisplay.textContent = dateFormatter.format(now);
    clockDisplay.dateTime = now.toISOString();
    clockDisplay.textContent = clockFormatter.format(now);
}

let dateTimeTimeout;

function scheduleDateTimeUpdate() {
    window.clearTimeout(dateTimeTimeout);
    const delay = 60000 - (Date.now() % 60000);
    dateTimeTimeout = window.setTimeout(() => {
        updateDateTime();
        scheduleDateTimeUpdate();
    }, delay);
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        updateDateTime();
        scheduleDateTimeUpdate();
    }
});

function normalizeTask(task) {
    if (typeof task === "string") {
        return {
            text: task,
            priority: "medium",
            project: "",
            category: "",
            reminderAt: null,
            reminderNotifiedAt: null
        };
    }
    return {
        text: typeof task.text === "string" ? task.text : "",
        priority: ["high", "medium", "low"].includes(task.priority) ? task.priority : "medium",
        project: typeof task.project === "string" ? task.project : "",
        category: typeof task.category === "string" ? task.category : "",
        reminderAt: typeof task.reminderAt === "string" && Number.isFinite(Date.parse(task.reminderAt))
            ? new Date(task.reminderAt).toISOString()
            : null,
        reminderNotifiedAt: typeof task.reminderNotifiedAt === "string" &&
            Number.isFinite(Date.parse(task.reminderNotifiedAt))
            ? new Date(task.reminderNotifiedAt).toISOString()
            : null
    };
}

function toDateTimeLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatReminderDate(value) {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date(value));
}

function matchesSearch(value) {
    const query = globalSearch.value.trim().toLocaleLowerCase();
    return !query || value.toLocaleLowerCase().includes(query);
}

function createMoveControls(items, item, onMove) {
    const controls = document.createElement("div");
    controls.className = "item-reorder";
    const index = items.indexOf(item);
    for (const [offset, label, glyph] of [
        [-1, "Move up", "↑"],
        [1, "Move down", "↓"]
    ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "move-item";
        button.textContent = glyph;
        button.setAttribute("aria-label", `${label}: ${item.text || item.name || item}`);
        button.disabled = index + offset < 0 || index + offset >= items.length;
        button.addEventListener("click", () => {
            const currentIndex = items.indexOf(item);
            const destination = currentIndex + offset;
            if (destination < 0 || destination >= items.length) return;
            items.splice(currentIndex, 1);
            items.splice(destination, 0, item);
            onMove();
        });
        controls.appendChild(button);
    }
    return controls;
}

function removeTask(task, element) {
    if (element.classList.contains("is-deleting")) return;
    const index = tasks.indexOf(task);
    if (index < 0) return;
    tasks.splice(index, 1);
    saveData({ tasks });
    updateStatistics();
    updateTaskFilters();
    element.classList.add("is-deleting");
    element.addEventListener("transitionend", event => {
        if (event.propertyName === "max-height") {
            element.remove();
            applySearch();
        }
    });
}

function renderTaskMetadata(task, container) {
    container.replaceChildren();
    for (const [value, className] of [
        [task.project, "project-tag"],
        [task.category, "category-tag"]
    ]) {
        if (!value) continue;
        const tag = document.createElement("span");
        tag.className = `task-tag ${className}`;
        tag.textContent = value;
        container.appendChild(tag);
    }
}

function taskMatchesFilters(task, query = globalSearch.value.trim().toLocaleLowerCase()) {
    return (!query || `${task.text} ${task.project} ${task.category}`
        .toLocaleLowerCase().includes(query)) &&
        (!taskPriorityFilter.value || task.priority === taskPriorityFilter.value) &&
        (!taskProjectFilter.value || task.project === taskProjectFilter.value) &&
        (!taskCategoryFilter.value || task.category === taskCategoryFilter.value);
}

function renderTask(task) {
    const item = document.createElement("article");
    item.className = "task-item";
    item.dataset.priority = task.priority;
    item.dataset.taskIndex = tasks.indexOf(task);

    const content = document.createElement("div");
    content.className = "task-content";
    const heading = document.createElement("div");
    heading.className = "task-heading";

    const title = document.createElement("button");
    title.type = "button";
    title.className = "task-name";
    title.textContent = task.text;
    title.title = "Complete and remove this task";
    title.addEventListener("click", () => removeTask(task, item));

    const priority = document.createElement("select");
    priority.className = "task-priority";
    priority.setAttribute("aria-label", `Priority for ${task.text}`);
    for (const value of ["high", "medium", "low"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `${value[0].toUpperCase()}${value.slice(1)}`;
        priority.appendChild(option);
    }
    priority.value = task.priority;
    priority.addEventListener("change", () => {
        task.priority = priority.value;
        item.dataset.priority = task.priority;
        saveData({ tasks });
        applySearch();
    });
    heading.append(title, priority);

    const metadata = document.createElement("div");
    metadata.className = "task-metadata";
    renderTaskMetadata(task, metadata);

    const details = document.createElement("details");
    details.className = "task-details";
    const summary = document.createElement("summary");
    summary.textContent = "Edit task details";
    const fields = document.createElement("div");
    fields.className = "task-detail-fields";
    for (const [key, labelText, maxLength] of [
        ["project", "Project", 60],
        ["category", "Category", 40]
    ]) {
        const label = document.createElement("label");
        label.textContent = labelText;
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = maxLength;
        input.value = task[key];
        input.addEventListener("change", () => {
            task[key] = input.value.trim();
            saveData({ tasks });
            renderTaskMetadata(task, metadata);
            updateTaskFilters();
            applySearch(false);
        });
        label.appendChild(input);
        fields.appendChild(label);
    }
    const reminderFields = document.createElement("div");
    reminderFields.className = "task-reminder-fields";
    const reminderLabel = document.createElement("label");
    reminderLabel.className = "reminder-enable";
    const reminderEnabled = document.createElement("input");
    reminderEnabled.type = "checkbox";
    reminderEnabled.checked = Boolean(task.reminderAt);
    reminderLabel.append(reminderEnabled, document.createTextNode("Set a reminder"));

    const reminderDateLabel = document.createElement("label");
    reminderDateLabel.textContent = "Remind me at";
    const reminderDate = document.createElement("input");
    reminderDate.type = "datetime-local";
    reminderDate.value = toDateTimeLocal(task.reminderAt);
    reminderDate.disabled = !reminderEnabled.checked;
    reminderDate.required = reminderEnabled.checked;
    reminderDateLabel.appendChild(reminderDate);
    reminderEnabled.addEventListener("change", () => {
        reminderDate.disabled = !reminderEnabled.checked;
        reminderDate.required = reminderEnabled.checked;
        if (!reminderEnabled.checked) {
            task.reminderAt = null;
            task.reminderNotifiedAt = null;
            saveData({ tasks });
            renderReminders();
            applySearch(false);
        } else if (!reminderDate.value) {
            reminderDate.focus();
        }
    });
    reminderDate.addEventListener("change", () => {
        const reminderAt = fromDateTimeLocal(reminderDate.value);
        if (!reminderAt) {
            task.reminderAt = null;
            task.reminderNotifiedAt = null;
        } else if (reminderAt !== task.reminderAt) {
            task.reminderAt = reminderAt;
            task.reminderNotifiedAt = null;
        }
        saveData({ tasks });
        renderReminders();
        applySearch(false);
    });
    reminderFields.append(reminderLabel, reminderDateLabel);
    details.append(summary, fields, reminderFields);
    content.append(heading, metadata, details);
    item.append(content, createMoveControls(tasks, task, () => {
        saveData({ tasks });
        applySearch();
    }));
    tasksContainer.appendChild(item);
}

function updateTaskFilters() {
    for (const [select, property, firstLabel] of [
        [taskProjectFilter, "project", "All projects"],
        [taskCategoryFilter, "category", "All categories"]
    ]) {
        const selected = select.value;
        const values = [...new Set(tasks.map(task => task[property]).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right));
        select.replaceChildren(new Option(firstLabel, ""));
        for (const value of values) select.add(new Option(value, value));
        select.value = values.includes(selected) ? selected : "";
    }
}

function renderTasks() {
    updateTaskFilters();
    const query = globalSearch.value.trim();
    const filteredTasks = tasks.filter(task => taskMatchesFilters(task));
    tasksContainer.replaceChildren();
    tasksContainer.dataset.filtered = String(Boolean(query || taskPriorityFilter.value ||
        taskProjectFilter.value || taskCategoryFilter.value));
    filteredTasks.forEach(renderTask);
    return filteredTasks.length;
}

function renderReminders() {
    const container = $("reminders-container");
    const reminders = tasks
        .filter(task => task.reminderAt)
        .sort((left, right) => Date.parse(left.reminderAt) - Date.parse(right.reminderAt));
    container.replaceChildren();
    for (const task of reminders) {
        const item = document.createElement("article");
        item.className = "reminder-item";
        item.hidden = !matchesSearch(task.text);

        const content = document.createElement("div");
        content.className = "reminder-content";
        const title = document.createElement("strong");
        title.textContent = task.text;
        const time = document.createElement("time");
        time.dateTime = task.reminderAt;
        time.textContent = formatReminderDate(task.reminderAt);
        const state = document.createElement("span");
        state.className = task.reminderNotifiedAt ? "reminder-state is-sent" : "reminder-state";
        state.textContent = task.reminderNotifiedAt
            ? `Reminder sent ${formatReminderDate(task.reminderNotifiedAt)}`
            : Date.parse(task.reminderAt) <= Date.now()
                ? "Due now"
                : "Upcoming";
        content.append(title, time, state);

        const actions = document.createElement("div");
        actions.className = "reminder-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => {
            globalSearch.value = "";
            taskPriorityFilter.value = "";
            taskProjectFilter.value = "";
            taskCategoryFilter.value = "";
            applySearch();
            const taskElement = tasksContainer.querySelector(
                `[data-task-index="${tasks.indexOf(task)}"]`
            );
            const details = taskElement?.querySelector(".task-details");
            const reminderInput = details?.querySelector('input[type="datetime-local"]');
            if (!taskElement || !details || !reminderInput) return;
            details.open = true;
            taskElement.scrollIntoView({ behavior: "smooth", block: "center" });
            reminderInput.focus();
        });

        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "remove-item";
        clear.textContent = "Remove reminder";
        clear.setAttribute("aria-label", `Remove reminder for ${task.text}`);
        clear.addEventListener("click", () => {
            task.reminderAt = null;
            task.reminderNotifiedAt = null;
            saveData({ tasks });
            renderTasks();
            applySearch();
        });
        actions.append(edit, clear);
        item.append(content, actions);
        container.appendChild(item);
    }
}

function showReminderAlert(task) {
    const alert = document.createElement("section");
    alert.className = "reminder-alert";
    alert.setAttribute("role", "status");
    const title = document.createElement("strong");
    title.textContent = "Reminder";
    const message = document.createElement("p");
    message.textContent = task.text;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => alert.remove());
    alert.append(title, message, dismiss);
    $("reminder-alerts").appendChild(alert);
}

function checkReminders() {
    const now = Date.now();
    const dueReminders = tasks.filter(task =>
        task.reminderAt &&
        !task.reminderNotifiedAt &&
        Date.parse(task.reminderAt) <= now
    );
    if (dueReminders.length === 0) return;

    const notifiedAt = new Date(now).toISOString();
    for (const task of dueReminders) {
        task.reminderNotifiedAt = notifiedAt;
        showReminderAlert(task);
    }
    saveData({ tasks });
    renderReminders();
}

function renderGoal(goal) {
    const item = document.createElement("div");
    item.className = "goal-item";

    const name = document.createElement("span");
    name.className = "goal-name";
    name.textContent = goal.name;

    const progress = document.createElement("input");
    progress.type = "range";
    progress.min = "0";
    progress.max = "100";
    progress.value = goal.progress;
    progress.setAttribute("aria-label", `${goal.name} progress`);

    const percentage = document.createElement("output");
    percentage.className = "goal-percentage";
    percentage.textContent = `${goal.progress}%`;
    progress.addEventListener("input", () => {
        goal.progress = Number(progress.value);
        percentage.textContent = `${goal.progress}%`;
        saveData({ goals });
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-item";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove goal: ${goal.name}`);
    remove.addEventListener("click", () => {
        goals = goals.filter(item => item !== goal);
        saveData({ goals });
        renderGoals();
        applySearch();
        updateStatistics();
    });

    item.append(name, progress, percentage, remove, createMoveControls(goals, goal, () => {
        saveData({ goals });
        renderGoals();
        applySearch();
    }));
    goalsContainer.appendChild(item);
}

function renderGoals() {
    goalsContainer.replaceChildren();
    goals.forEach(renderGoal);
}

function renderHabit(habit) {
    const item = document.createElement("div");
    item.className = "habit-item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = habit;
    input.id = `habit-${habitsForm.querySelectorAll('input[type="checkbox"]').length}`;

    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.textContent = habit;
    input.checked = completedHabits.includes(habit);
    label.classList.toggle("is-complete", input.checked);
    input.addEventListener("change", () => {
        label.classList.toggle("is-complete", input.checked);
        completedHabits = input.checked
            ? [...new Set([...completedHabits, habit])]
            : completedHabits.filter(item => item !== habit);
        saveData({ completedHabits });
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-item";
    remove.textContent = "×";
    remove.title = "Remove habit";
    remove.setAttribute("aria-label", `Remove habit: ${habit}`);
    remove.addEventListener("click", () => {
        const index = [...habitsForm.children].indexOf(item);
        habits.splice(index, 1);
        if (!habits.includes(habit)) {
            completedHabits = completedHabits.filter(completed => completed !== habit);
            saveData({ completedHabits });
        }
        saveData({ habits, completedHabits });
        renderHabits();
        applySearch();
        updateStatistics();
    });

    item.append(input, label, remove, createMoveControls(habits, habit, () => {
        saveData({ habits });
        renderHabits();
        applySearch();
    }));
    habitsForm.appendChild(item);
}

function renderHabits() {
    habitsForm.replaceChildren();
    habits.forEach(renderHabit);
}

function addTask() {
    const text = addTaskInput.value.trim();
    if (!text) return;
    const reminderEnabled = $("add-task-reminder-enabled").checked;
    const reminderAt = fromDateTimeLocal($("add-task-reminder-at").value);
    if (reminderEnabled && !reminderAt) {
        backupStatus.textContent = "Choose a date and time for this task reminder.";
        $("add-task-reminder-at").focus();
        return;
    }
    const task = {
        text,
        priority: $("add-task-priority").value,
        project: $("add-task-project").value.trim(),
        category: $("add-task-category").value.trim(),
        reminderAt: reminderEnabled ? reminderAt : null,
        reminderNotifiedAt: null
    };
    tasks.push(task);
    addTaskInput.value = "";
    $("add-task-project").value = "";
    $("add-task-category").value = "";
    $("add-task-reminder-enabled").checked = false;
    $("add-task-reminder-at").value = "";
    $("add-task-reminder-at").disabled = true;
    $("add-task-reminder-at").required = false;
    addTaskTrigger.style.display = "block";
    addTaskContainer.style.display = "none";
    saveData({ tasks });
    applySearch();
    backupStatus.textContent = reminderAt
        ? `Task reminder set for ${formatReminderDate(reminderAt)}.`
        : "Task added.";
    updateStatistics();
}

function addHabit() {
    const habit = addHabitInput.value.trim();
    if (!habit) return;
    habits.push(habit);
    renderHabits();
    addHabitInput.value = "";
    addHabitTrigger.style.display = "block";
    addHabitContainer.style.display = "none";
    saveData({ habits });
    applySearch();
    updateStatistics();
}

function addGoal() {
    const name = addGoalInput.value.trim();
    if (!name) return;

    const goal = { name, progress: 0 };
    goals.push(goal);
    renderGoals();
    addGoalInput.value = "";
    addGoalTrigger.style.display = "block";
    addGoalContainer.style.display = "none";
    saveData({ goals });
    applySearch();
    updateStatistics();
}

function updateStatistics() {
    $("statistics-tasks").textContent = tasks.length;
    $("statistics-goals").textContent = goals.length;
    $("statistics-habits").textContent = habits.length;
    $("statistics-notes").textContent = [...notesInput.value].length;
}

function normalizeDashboard(value) {
    if (!value || !Array.isArray(value.order) || !Array.isArray(value.visible)) {
        return { order: [...defaultDashboard.order], visible: [...defaultDashboard.visible] };
    }
    const keys = dashboardSections.map(section => section.key);
    const order = [...new Set(value.order.filter(key => keys.includes(key)))];
    const visible = [...new Set(value.visible.filter(key => keys.includes(key)))];
    const isLegacyDashboard = !value.order.includes("reminders");
    if (isLegacyDashboard) {
        order.splice(Math.max(1, order.indexOf("tasks") + 1), 0, "reminders");
    }
    for (const key of keys) {
        if (!order.includes(key)) order.push(key);
    }
    if (isLegacyDashboard && !visible.includes("reminders")) visible.push("reminders");
    if (visible.length === 0) visible.push(keys[0]);
    return { order, visible };
}

function dashboardNeedsMigration(value) {
    return !isDashboardRecord(value) ||
        !value.order.includes("reminders");
}

function applyDashboardSettings() {
    dashboardGrid.append(...dashboard.order.map(key =>
        document.getElementById(dashboardSections.find(section => section.key === key).id)
    ));
    applySearch();
}

function renderDashboardSettings() {
    const list = $("dashboard-settings-list");
    list.replaceChildren();
    dashboard.order.forEach((key, index) => {
        const section = dashboardSections.find(item => item.key === key);
        const row = document.createElement("div");
        row.className = "dashboard-setting-row";

        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = dashboard.visible.includes(key);
        checkbox.addEventListener("change", () => {
            if (!checkbox.checked && dashboard.visible.length === 1) {
                checkbox.checked = true;
                backupStatus.textContent = "Keep at least one dashboard section visible.";
                return;
            }
            dashboard.visible = checkbox.checked
                ? [...dashboard.visible, key]
                : dashboard.visible.filter(visibleKey => visibleKey !== key);
            saveData({ dashboard });
            applyDashboardSettings();
        });
        label.append(checkbox, document.createTextNode(section.label));

        const controls = createMoveControls(dashboard.order, key, () => {
            renderDashboardSettings();
            applyDashboardSettings();
            saveData({ dashboard });
        });
        row.append(label, controls);
        list.appendChild(row);
    });
}

function applySearch(renderTaskList = true) {
    const taskCount = renderTaskList
        ? renderTasks()
        : tasks.filter(task => taskMatchesFilters(task)).length;
    renderReminders();
    if (!renderTaskList) {
        for (const element of tasksContainer.children) {
            const task = tasks[Number(element.dataset.taskIndex)];
            element.hidden = !task || !taskMatchesFilters(task);
        }
    }
    let resultCount = taskCount;
    const query = globalSearch.value.trim();
    const matchingReminders = tasks.filter(task => task.reminderAt && matchesSearch(task.text)).length;
    resultCount += matchingReminders;

    for (const [key, container, collection, getText] of [
        ["habits", habitsForm, habits, habit => habit],
        ["goals", goalsContainer, goals, goal => goal.name]
    ]) {
        let matchingItems = 0;
        for (const item of collection) {
            const element = [...container.children].find(child =>
                key === "habits"
                    ? child.querySelector("label")?.textContent === item
                    : child.querySelector(".goal-name")?.textContent === getText(item)
            );
            const matches = matchesSearch(getText(item));
            if (element) element.hidden = !matches;
            if (matches) matchingItems++;
        }
        resultCount += matchingItems;
    }

    const notesMatch = matchesSearch(notesInput.value);
    if (query && notesInput.value.trim() && notesMatch) resultCount++;
    const hasQuery = Boolean(query);
    for (const [key, hasResults] of [
        ["tasks", taskCount > 0],
        ["reminders", matchingReminders > 0],
        ["habits", habits.some(matchesSearch)],
        ["goals", goals.some(goal => matchesSearch(goal.name))],
        ["notes", !hasQuery || !notesInput.value.trim() || notesMatch ||
            document.activeElement === notesInput],
        ["statistics", true]
    ]) {
        const section = dashboardSections.find(item => item.key === key);
        document.getElementById(section.id).hidden =
            !dashboard.visible.includes(key) || (hasQuery && !hasResults);
    }

    const status = $("search-status");
    status.textContent = hasQuery
        ? resultCount === 0
            ? "No matching items."
            : `${resultCount} matching ${resultCount === 1 ? "item" : "items"}.`
        : "";
}

function setupComposer(trigger, container, input, add) {
    trigger.addEventListener("click", () => {
        trigger.style.display = "none";
        container.style.display = "block";
        input.focus();
    });
    container.querySelector("button").addEventListener("click", add);
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") add();
    });
}

function getBackupData() {
    return {
        app: "LifeOS",
        version: 3,
        exportedAt: new Date().toISOString(),
        data: {
            tasks,
            habits,
            completedHabits,
            goals,
            notes: notesInput.value,
            dashboard
        }
    };
}

async function downloadBackup() {
    await pendingWrites;
    const backup = new Blob([JSON.stringify(getBackupData(), null, 2)], {
        type: "application/json"
    });
    const url = URL.createObjectURL(backup);
    const link = document.createElement("a");
    const now = new Date();
    const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0")
    ].join("-");
    link.href = url;
    link.download = `lifeos-backup-${date}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupStatus.textContent = "Backup downloaded. Keep the JSON file somewhere safe.";
}

function isStringArray(value) {
    return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isTaskRecord(value) {
    const validReminderValue = item => item === undefined || item === null ||
        (typeof item === "string" && Number.isFinite(Date.parse(item)));
    return value &&
        typeof value === "object" &&
        typeof value.text === "string" &&
        ["high", "medium", "low"].includes(value.priority) &&
        typeof value.project === "string" &&
        typeof value.category === "string" &&
        validReminderValue(value.reminderAt) &&
        validReminderValue(value.reminderNotifiedAt) &&
        (value.reminderAt || value.reminderNotifiedAt == null);
}

function isDashboardRecord(value) {
    return value &&
        Array.isArray(value.order) &&
        Array.isArray(value.visible);
}

async function importBackup(file) {
    try {
        const backup = JSON.parse(await file.text());
        const data = backup?.data || {};
        const importedTasks = data.tasks;
        const { habits, completedHabits } = data;
        const importedGoals = data.goals === undefined ? [] : data.goals;
        if (
            backup?.app !== "LifeOS" ||
            ![1, 2, 3].includes(backup.version) ||
            !Array.isArray(importedTasks) ||
            !importedTasks.every(task =>
                typeof task === "string" || isTaskRecord(task)
            ) ||
            !isStringArray(habits) ||
            !isStringArray(completedHabits) ||
            !Array.isArray(importedGoals) ||
            !importedGoals.every(goal =>
                goal &&
                typeof goal.name === "string" &&
                goal.name.trim().length > 0 &&
                Number.isInteger(goal.progress) &&
                goal.progress >= 0 &&
                goal.progress <= 100
            ) ||
            (data.notes !== undefined && typeof data.notes !== "string") ||
            !completedHabits.every(habit => habits.includes(habit)) ||
            (data.dashboard !== undefined &&
                (!isDashboardRecord(data.dashboard) ||
                    !data.dashboard.order.every(key =>
                        dashboardSections.some(section => section.key === key)
                    ) ||
                    !data.dashboard.visible.every(key =>
                        dashboardSections.some(section => section.key === key)
                    )))
        ) {
            throw new Error("This file is not a valid LifeOS backup.");
        }
        if (!confirm("Import this backup and replace the data for this account?")) {
            backupStatus.textContent = "Import cancelled.";
            return;
        }

        const importedData = {
            tasks: importedTasks.map(normalizeTask),
            habits,
            completedHabits,
            goals: importedGoals,
            notes: data.notes || "",
            dashboard: normalizeDashboard(data.dashboard)
        };
        if (localFileMode) {
            for (const [key, value] of Object.entries(importedData)) {
                localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
            }
        } else {
            await pendingWrites;
            await apiRequest("/api/data", {
                method: "PUT",
                body: JSON.stringify(importedData)
            });
        }
        location.reload();
    } catch (error) {
        backupStatus.textContent = error instanceof SyntaxError
            ? "Could not read that file as JSON."
            : `Could not import backup: ${error.message}`;
    }
}

function localBrowserData() {
    return {
        tasks: JSON.parse(localStorage.getItem("tasks") || "[]"),
        habits: JSON.parse(localStorage.getItem("habits") || "[]"),
        completedHabits: JSON.parse(localStorage.getItem("completedHabits") || "[]"),
        goals: JSON.parse(localStorage.getItem("goals") || "[]"),
        notes: localStorage.getItem("notes") || "",
        dashboard: normalizeDashboard(JSON.parse(localStorage.getItem("dashboard") || "null"))
    };
}

function hasSavedData(data) {
    return data.tasks.length > 0 ||
        data.habits.length > 0 ||
        data.goals.length > 0 ||
        data.notes.length > 0;
}

async function initialize() {
    if (localFileMode) {
        showApp(localBrowserData(), { username: "Local browser" });
        return;
    }

    $("auth-panel").hidden = false;
    $("app-content").hidden = true;
    $("auth-message").textContent = "Enter the server passcode to continue.";
    const status = await apiRequest("/api/auth/status");
    if (status.authenticated) {
        const { data } = await apiRequest("/api/data");
        showApp(data, status.user);
        return;
    }

    showAccountForm(status.usersExist ? "login" : "signup");
}

function showAccountForm(mode) {
    $("server-access-form").hidden = true;
    $("account-panel").hidden = false;
    $("auth-heading").textContent = "Welcome to LifeOS";
    $("auth-message").textContent = "Log in or create an account to open your personal LifeOS.";
    $("account-heading").textContent = mode === "signup" ? "Create an account" : "Log in";
    $("account-submit").textContent = mode === "signup" ? "Sign up" : "Log in";
    $("account-mode-toggle").textContent = mode === "signup"
        ? "Already have an account? Log in"
        : "New to LifeOS? Create an account";
    $("account-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
    $("account-panel").dataset.mode = mode;
    $("account-username").focus();
}

function showApp(data, user) {
    activeUser = user;
    const savedTasks = data.tasks;
    tasks = savedTasks.map(normalizeTask);
    habits = data.habits;
    completedHabits = data.completedHabits;
    goals = data.goals;
    dashboard = normalizeDashboard(data.dashboard);
    renderHabits();
    renderGoals();
    notesInput.value = data.notes;
    renderTasks();
    renderDashboardSettings();
    applyDashboardSettings();
    if (savedTasks.some(task =>
        typeof task === "string" ||
        !Object.hasOwn(task, "reminderAt") ||
        !Object.hasOwn(task, "reminderNotifiedAt")
    ) || dashboardNeedsMigration(data.dashboard)) {
        saveData({ tasks, dashboard });
    }
    $("account-name").textContent = user.username;
    $("logout-button").hidden = localFileMode;
    $("auth-panel").hidden = true;
    $("app-content").hidden = false;

    setupComposer(addTaskTrigger, addTaskContainer, addTaskInput, addTask);
    setupComposer(addHabitTrigger, addHabitContainer, addHabitInput, addHabit);
    setupComposer(addGoalTrigger, addGoalContainer, addGoalInput, addGoal);
    const addReminderEnabled = $("add-task-reminder-enabled");
    const addReminderAt = $("add-task-reminder-at");
    addReminderEnabled.addEventListener("change", () => {
        addReminderAt.disabled = !addReminderEnabled.checked;
        addReminderAt.required = addReminderEnabled.checked;
        if (addReminderEnabled.checked) addReminderAt.focus();
    });
    notesInput.addEventListener("input", () => {
        saveData({ notes: notesInput.value });
        updateStatistics();
        applySearch();
    });
    globalSearch.addEventListener("input", applySearch);
    for (const filter of [taskPriorityFilter, taskProjectFilter, taskCategoryFilter]) {
        filter.addEventListener("change", applySearch);
    }
    $("statistics-toggle").addEventListener("click", event => {
        const button = event.currentTarget;
        const expanded = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!expanded));
        button.textContent = expanded ? "Show statistics" : "Hide statistics";
        $("statistics-panel").hidden = expanded;
    });
    checkReminders();
    window.setInterval(checkReminders, 15000);
    $("export-backup").addEventListener("click", downloadBackup);
    $("import-backup-trigger").addEventListener("click", () => $("import-backup-input").click());
    $("import-backup-input").addEventListener("change", event => {
        const input = event.currentTarget;
        if (input.files[0]) importBackup(input.files[0]);
        input.value = "";
    });
    $("logout-button").addEventListener("click", async () => {
        try {
            await apiRequest("/api/auth/logout", { method: "POST" });
            location.reload();
        } catch (error) {
            backupStatus.textContent = `Could not log out: ${error.message}`;
        }
    });
    $("customize-dashboard").addEventListener("click", () => {
        document.querySelector(".header-menu").open = false;
        $("dashboard-dialog").showModal();
    });
    $("open-settings").addEventListener("click", () => {
        document.querySelector(".header-menu").open = false;
        $("settings-status").textContent = "";
        $("settings-theme").value = document.documentElement.dataset.theme;
        $("settings-username").value = activeUser.username;
        $("delete-account-name").textContent = activeUser.username;
        $("local-account-settings").hidden = !localFileMode;
        document.querySelectorAll(".account-setting").forEach(section => {
            section.hidden = localFileMode;
        });
        $("settings-dialog").showModal();
    });
    $("settings-close").addEventListener("click", () => $("settings-dialog").close());
    $("settings-theme").addEventListener("change", event => setTheme(event.currentTarget.value));
    $("username-form").addEventListener("submit", async event => {
        event.preventDefault();
        const submit = event.currentTarget.querySelector("button[type='submit']");
        submit.disabled = true;
        $("settings-status").textContent = "Updating username...";
        try {
            const result = await apiRequest("/api/auth/update", {
                method: "POST",
                body: JSON.stringify({
                    username: $("settings-username").value.trim(),
                    currentPassword: $("username-current-password").value
                })
            });
            activeUser = result.user;
            $("account-name").textContent = activeUser.username;
            $("delete-account-name").textContent = activeUser.username;
            $("username-current-password").value = "";
            $("settings-status").textContent = "Username updated.";
        } catch (error) {
            $("settings-status").textContent = `Could not update username: ${error.message}`;
        } finally {
            submit.disabled = false;
        }
    });
    $("password-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const newPassword = $("settings-new-password").value;
        if (newPassword !== $("settings-confirm-password").value) {
            $("settings-status").textContent = "The new passwords do not match.";
            $("settings-confirm-password").focus();
            return;
        }
        const submit = form.querySelector("button[type='submit']");
        submit.disabled = true;
        $("settings-status").textContent = "Updating password...";
        try {
            await apiRequest("/api/auth/update", {
                method: "POST",
                body: JSON.stringify({
                    newPassword,
                    currentPassword: $("password-current-password").value
                })
            });
            form.reset();
            $("settings-status").textContent = "Password changed. Other signed-in sessions have been logged out.";
        } catch (error) {
            $("settings-status").textContent = `Could not change password: ${error.message}`;
        } finally {
            submit.disabled = false;
        }
    });
    $("delete-account-form").addEventListener("submit", async event => {
        event.preventDefault();
        if ($("delete-account-username").value !== activeUser.username) {
            $("settings-status").textContent = "The confirmation username does not match.";
            $("delete-account-username").focus();
            return;
        }
        if (!confirm(`Permanently delete ${activeUser.username} and all of its LifeOS data? This cannot be undone.`)) {
            $("settings-status").textContent = "Account deletion cancelled.";
            return;
        }
        const submit = event.currentTarget.querySelector("button[type='submit']");
        submit.disabled = true;
        $("settings-status").textContent = "Deleting account...";
        try {
            await apiRequest("/api/auth/delete", {
                method: "POST",
                body: JSON.stringify({
                    confirmUsername: $("delete-account-username").value,
                    password: $("delete-account-password").value
                })
            });
            $("settings-status").textContent = "Account deleted.";
            location.reload();
        } catch (error) {
            $("settings-status").textContent = `Could not delete account: ${error.message}`;
        } finally {
            submit.disabled = false;
        }
    });
    updateStatistics();
    if (localFileMode) {
        backupStatus.textContent = "Local browser mode. Download a backup to transfer data to the server.";
    } else {
        backupStatus.textContent = `Logged in as ${user.username}.`;
    }
}

$("server-access-form").addEventListener("submit", event => {
    event.preventDefault();
    const input = $("server-access-token");
    const token = input.value.trim();
    if (!token) return;

    input.value = "";
    $("server-access-form").hidden = true;
    resolveAccessToken(token);
    resolveAccessToken = null;
});

$("account-mode-toggle").addEventListener("click", () => {
    showAccountForm($("account-panel").dataset.mode === "signup" ? "login" : "signup");
});

$("account-form").addEventListener("submit", async event => {
    event.preventDefault();
    const mode = $("account-panel").dataset.mode;
    const submit = $("account-submit");
    submit.disabled = true;
    $("auth-message").textContent = mode === "signup" ? "Creating your account..." : "Logging in...";
    try {
        const result = await apiRequest(`/api/auth/${mode}`, {
            method: "POST",
            body: JSON.stringify({
                username: $("account-username").value.trim(),
                password: $("account-password").value
            })
        });
        if (mode === "signup" && result.isEmpty) {
            const browserData = localBrowserData();
            if (hasSavedData(browserData) &&
                confirm("Copy this browser's saved tasks, habits, goals, and notes into your new account?")) {
                try {
                    ({ data: result.data } = await apiRequest("/api/migrate", {
                        method: "POST",
                        body: JSON.stringify(browserData)
                    }));
                } catch (error) {
                    if (!error.message.startsWith("Account data already exists")) throw error;
                    ({ data: result.data } = await apiRequest("/api/data"));
                }
            }
        }
        showApp(result.data, result.user);
    } catch (error) {
        $("auth-message").textContent = error.message;
    } finally {
        submit.disabled = false;
    }
});

updateDateTime();
scheduleDateTimeUpdate();
initialize().catch(error => {
    $("auth-panel").hidden = false;
    $("auth-message").textContent = `Could not connect to LifeOS: ${error.message}`;
});

$("theme-toggle").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

setTheme(localStorage.getItem("theme") === "dark" ? "dark" : "light");
