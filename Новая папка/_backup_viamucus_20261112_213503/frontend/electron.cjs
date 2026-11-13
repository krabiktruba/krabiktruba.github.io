const { app, BrowserWindow, session } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 600,
    title: "COMIND",
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error("PAGE LOAD FAILED:", code, description, url);
  });

  win.webContents.on("console-message", (event) => {
    console.log("RENDERER:", event.message);
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("RENDERER PROCESS GONE:", details);
  });

  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("PRELOAD ERROR:", preloadPath, error);
  });

  const page = path.join(__dirname, "dist", "index.html");

  win.loadFile(page).then(() => {
    console.log("COMIND PAGE LOADED:", page);
  }).catch(error => {
    console.error("LOAD ERROR:", error);
  });
}

app.whenReady().then(() => {
  const { session } = require("electron");
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

