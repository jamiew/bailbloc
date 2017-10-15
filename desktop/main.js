const path = require('path');
const os = require('os');
const url = require('url');
const platform = require('os').platform();
const {app, Menu, Tray, BrowserWindow, ipcMain, dialog} = require('electron');
const settings = require('electron-settings');
const {autoUpdater} = require('electron-updater');
const log = require('electron-log');
const isCharging = require('is-charging');
const batteryLevel = require('battery-level');
const uuidv4 = require('uuid/v4');
const Miner = require('./miner.js');

const UPDATE_CHECK = 12 * 60 * 60 * 1000;
const CHARGE_CHECK = 5 * 60 * 1000;

const isSecondInstance = app.makeSingleInstance((commandLine, workingDirectory) => {
  //this callback executes when someone tries to run a second instance of the app.
});

if (isSecondInstance) {
  app.quit();
}

let activeTrayImage, passiveTrayImage;
let tray = null;
let contextMenu = null;
let windows = {};
let totalCPUs = os.cpus().length;
let miner = new Miner();
let mySettings = {};

let defaultSettings = {
  maxUsage: 25,
  autostart: true,
  pauseOnLowPower: true,
  uuid: undefined
};

if (platform === 'darwin') {
  activeTrayImage = path.join(__dirname, 'assets', 'macos-icon.png');
  passiveTrayImage = path.join(__dirname, 'assets', 'macos-fade_icon.png');
} else if (platform === 'win32') {
  activeTrayImage = path.join(__dirname, 'assets', 'win-icon.png');
  passiveTrayImage = path.join(__dirname, 'assets', 'win-fade_icon.png');
}

function toggleMiner(e) {
  if (miner.mining) {
    stopMining();
  } else {
    startMining();
  }
}

function startMining() {
  tray.setImage(activeTrayImage);
  contextMenu.items[0].checked = true;
  miner.start();
}

function stopMining() {
  tray.setImage(passiveTrayImage);
  contextMenu.items[0].checked = false;
  miner.stop();
}

function checkUpdates() {
  autoUpdater.checkForUpdates();
}

function checkCharging() {
  if (!mySettings.pauseOnLowPower) {
    return false;
  }

  batteryLevel().then(level => {
    isCharging().then(charging => {
      console.log('status', charging, level);
      if (!charging && level < 0.6 && miner.mining) {
        console.log('stopping');
        stopMining();
      } else if ((charging || level > 0.6) && !miner.mining) {
        console.log('starting');
        startMining();
      }
    });
  });
}

function getSettings() {
  let mySettings = {};

  for (let key in defaultSettings) {
    mySettings[key] = settings.get(key, defaultSettings[key]);
  }

  if (mySettings.uuid === undefined) {
    let uuid = uuidv4();
    mySettings.uuid = uuid;
    settings.set('uuid', uuid);
  }

  return mySettings;
}

function updateSettings(newSettings) {
  if (newSettings.maxUsage && newSettings.maxUsage != mySettings.maxUsage) {
    miner.updateArgs({'--max-cpu-usage': newSettings.maxUsage});
    miner.restart();
  }

  for (var key in newSettings) {
    mySettings[key] = newSettings[key];
    settings.set(key, newSettings[key]);
  }

  app.setLoginItemSettings({openAtLogin: mySettings.autostart});
}

function makeWindow(filename, extraParams) {
  if (windows[filename]) {
    windows[filename].show();
    return windows[filename];
  }

  let params = {
    width: 800,
    height: 600,
    show: false
  };

  if (extraParams) Object.assign(params, extraParams);

  windows[filename] = new BrowserWindow(params);

  windows[filename].once('ready-to-show', () => {
    windows[filename].show();
  });

  windows[filename].loadURL(
    url.format({
      pathname: path.join(__dirname, filename),
      protocol: 'file:',
      slashes: true
    })
  );

  windows[filename].on('close', e => {
    if (!app.isQuiting) {
      e.preventDefault();
      windows[filename].hide();
    }
    return false;
  });

  windows[filename].on('closed', e => {
    windows[filename] = null;
  });

  return windows[filename];
}

autoUpdater.on('checking-for-update', () => {
  log.warn('Checking for update...');
});

autoUpdater.on('update-available', (ev, info) => {
  log.warn('Update available.');
});

autoUpdater.on('update-not-available', (ev, info) => {
  log.warn('Update not available.');
});

autoUpdater.on('error', (ev, err) => {
  log.warn('Error in auto-updater.');
  log.error(err);
});

autoUpdater.on('download-progress', (ev, progressObj) => {
  log.warn('Download progress...');
});

autoUpdater.on('update-downloaded', (ev, info) => {
  autoUpdater.quitAndInstall();
});

app.on('ready', () => {
  tray = new Tray(activeTrayImage);
  contextMenu = Menu.buildFromTemplate([
    {
      label: 'Run Bail Bloc',
      type: 'checkbox',
      checked: true,
      click: toggleMiner
    },
    {type: 'separator'},
    {
      label: 'Stats',
      click() {
        let statsWindow = makeWindow('stats.html');
        statsWindow.uuid = mySettings.uuid;
      }
    },
    {
      label: 'About',
      click() {
        let aboutWindow = makeWindow('about.html');
        aboutWindow.version = app.getVersion();
        aboutWindow.uuid = mySettings.uuid;
      }
    },
    {
      label: 'Settings',
      click() {
        let settingsWin = makeWindow('settings.html', {
          width: 400,
          height: 200,
          resizable: false,
          minimizable: false,
          maximizable: false
        });
        settingsWin.settings = mySettings;
        settingsWin.totalCPUs = totalCPUs;
      }
    },
    // {
    //   label: 'Check For Updates',
    //   click: checkUpdates
    // },
    {type: 'separator'},
    {
      label: 'Quit',
      click() {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  mySettings = getSettings();
  app.setLoginItemSettings({openAtLogin: mySettings.autostart});

  checkUpdates();

  setInterval(checkUpdates, UPDATE_CHECK);
  setInterval(checkCharging, CHARGE_CHECK);

  miner.updateArgs({
    '--max-cpu-usage': mySettings.maxUsage,
    '--pass': mySettings.uuid + ':bailbloc@thenewinquiry.com'
  });
  miner.start();
});

app.on('quit', () => {
  miner.stop();
});

ipcMain.on('changeSettings', (event, arg) => {
  updateSettings(arg);
});