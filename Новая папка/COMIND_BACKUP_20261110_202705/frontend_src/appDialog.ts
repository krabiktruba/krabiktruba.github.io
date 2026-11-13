
type DialogOption = {
  value: string;
  label: string;
};

type DialogBase = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
};

type DialogConfig =
  | (DialogBase & {
      kind: "text" | "textarea";
      defaultValue?: string;
      placeholder?: string;
      rows?: number;
    })
  | (DialogBase & {
      kind: "select";
      options: DialogOption[];
      defaultValue?: string;
    })
  | (DialogBase & {
      kind: "confirm";
      danger?: boolean;
    });

let activeDialog: {
  root: HTMLDivElement;
  finish: (value: string | boolean | null) => void;
} | null = null;

function ensureDialogStyles(): void {
  if (document.getElementById("comind-app-dialog-styles")) return;

  const style = document.createElement("style");
  style.id = "comind-app-dialog-styles";

  style.textContent = `
    .comind-dialog-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(3, 7, 18, .78);
      backdrop-filter: blur(9px);
      animation: comindDialogFade .16s ease;
    }

    .comind-dialog {
      width: min(440px, 100%);
      max-height: min(90vh, 680px);
      overflow-y: auto;
      padding: 24px;
      color: #eef2ff;
      background: linear-gradient(145deg, #141c35, #0d1428);
      border: 1px solid rgba(139, 92, 246, .32);
      border-radius: 18px;
      box-shadow: 0 25px 90px rgba(0,0,0,.55);
      font-family: Inter, system-ui, sans-serif;
      animation: comindDialogIn .18s ease;
    }

    .comind-dialog-title {
      margin: 0 0 9px;
      font-size: 19px;
      font-weight: 700;
      line-height: 1.35;
    }

    .comind-dialog-message {
      margin: 0 0 19px;
      color: #aab5ce;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .comind-dialog-field {
      display: block;
      width: 100%;
      box-sizing: border-box;
      min-height: 43px;
      padding: 11px 13px;
      margin-bottom: 20px;
      color: #f1f5ff;
      background: #080f20;
      border: 1px solid #34415f;
      border-radius: 10px;
      outline: none;
      font: inherit;
      font-size: 14px;
      resize: vertical;
      transition: border-color .15s, box-shadow .15s;
    }

    .comind-dialog-field:focus {
      border-color: #8b5cf6;
      box-shadow: 0 0 0 3px rgba(139, 92, 246, .15);
    }

    .comind-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .comind-dialog-button {
      min-height: 39px;
      padding: 0 17px;
      border: 1px solid transparent;
      border-radius: 9px;
      color: white;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      transition: filter .15s, background .15s;
    }

    .comind-dialog-button:hover {
      filter: brightness(1.13);
    }

    .comind-dialog-cancel {
      color: #d1d8e9;
      background: #252f49;
      border-color: #394663;
    }

    .comind-dialog-submit {
      background: linear-gradient(110deg, #7046dc, #8955ee);
    }

    .comind-dialog-danger {
      background: #b93855;
    }

    @keyframes comindDialogFade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes comindDialogIn {
      from { opacity: 0; transform: translateY(8px) scale(.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;

  document.head.appendChild(style);
}

function showDialog(
  config: DialogConfig
): Promise<string | boolean | null> {
  ensureDialogStyles();

  return new Promise((resolve) => {
    if (activeDialog) {
      activeDialog.finish(null);
    }

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const backdrop = document.createElement("div");
    backdrop.className = "comind-dialog-backdrop";

    const panel = document.createElement("section");
    panel.className = "comind-dialog";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "comind-dialog-title");

    const form = document.createElement("form");
    form.noValidate = true;

    const heading = document.createElement("h2");
    heading.className = "comind-dialog-title";
    heading.id = "comind-dialog-title";
    heading.textContent = config.title;
    form.appendChild(heading);

    if (config.message) {
      const message = document.createElement("p");
      message.className = "comind-dialog-message";
      message.textContent = config.message;
      form.appendChild(message);
    }

    let field:
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null = null;

    if (config.kind === "text") {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "comind-dialog-field";
      input.value = config.defaultValue ?? "";
      input.placeholder = config.placeholder ?? "";
      input.maxLength = 150;
      input.autocomplete = "off";
      field = input;
    }

    if (config.kind === "textarea") {
      const area = document.createElement("textarea");
      area.className = "comind-dialog-field";
      area.value = config.defaultValue ?? "";
      area.placeholder = config.placeholder ?? "";
      area.rows = config.rows ?? 4;
      area.maxLength = 2000;
      field = area;
    }

    if (config.kind === "select") {
      const select = document.createElement("select");
      select.className = "comind-dialog-field";

      for (const item of config.options) {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        select.appendChild(option);
      }

      if (config.defaultValue !== undefined) {
        select.value = config.defaultValue;
      }

      field = select;
    }

    if (field) {
      field.setAttribute("aria-label", config.title);
      form.appendChild(field);
    }

    const actions = document.createElement("div");
    actions.className = "comind-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "comind-dialog-button comind-dialog-cancel";
    cancel.textContent = config.cancelText ?? "??????";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "comind-dialog-button comind-dialog-submit";
    submit.textContent = config.confirmText ?? "???????????";

    if (config.kind === "confirm" && config.danger) {
      submit.classList.add("comind-dialog-danger");
    }

    actions.append(cancel, submit);
    form.appendChild(actions);
    panel.appendChild(form);
    backdrop.appendChild(panel);

    let settled = false;

    const cancelValue =
      config.kind === "confirm" ? false : null;

    const finish = (value: string | boolean | null) => {
      if (settled) return;
      settled = true;

      document.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();

      if (activeDialog?.root === backdrop) {
        activeDialog = null;
      }

      previousFocus?.focus();
      resolve(value);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(cancelValue);
      }
    };

    activeDialog = {
      root: backdrop,
      finish,
    };

    cancel.addEventListener("click", () => finish(cancelValue));

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      if (config.kind === "confirm") {
        finish(true);
      } else {
        finish(field?.value ?? "");
      }
    });

    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) {
        finish(cancelValue);
      }
    });

    document.addEventListener("keydown", onKeyDown, true);
    document.body.appendChild(backdrop);

    field?.focus();
    if (field instanceof HTMLInputElement) {
      field.select();
    }
  });
}

export function appPrompt(options: {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  multiline?: boolean;
  rows?: number;
}): Promise<string | null> {
  const result = showDialog({
    ...options,
    kind: options.multiline ? "textarea" : "text",
  });

  return result.then((value) =>
    typeof value === "string" ? value : null
  );
}

export function appSelect(options: {
  title: string;
  message?: string;
  options: DialogOption[];
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}): Promise<string | null> {
  const result = showDialog({
    ...options,
    kind: "select",
  });

  return result.then((value) =>
    typeof value === "string" ? value : null
  );
}

export function appConfirm(options: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}): Promise<boolean> {
  const result = showDialog({
    ...options,
    kind: "confirm",
  });

  return result.then((value) => value === true);
}
