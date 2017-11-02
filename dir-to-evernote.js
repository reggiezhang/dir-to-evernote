#!/usr/bin/env node
/*
 * dir-to-evernote.js <dir_path>
 * Import Whole dir files as seperated note into a newly created local notebook.
 *  -  notebook named as <rootDirName: date>
 *  -  filename as note title
 *  -  file attached as attachment
 *  -  tags will be applied as root dir name and parent dir name of target file.
 * Copyright (C) 2017 Reggie Zhang <reggy.zhang@gmail.com>
 * Licensed under the terms of The GNU Lesser General Public License (LGPLv3):
 * http://www.opensource.org/licenses/lgpl-3.0.html
 *
 */

'use strict';
const SYNC_DIR_NAME = '.dir-to-evernote';
const SYNC_DIR_NAME_OLD = '.en-sync'; // <= 0.2.10
function initProgressBar(totalLength, notebookName, counter) {
  const ProgressBar = require('progress');
  return new ProgressBar(':percent|:bar|  :current/:total  elapsed: :elapseds  eta: :etas  :filename', {
    complete: '█',
    incomplete: ' ',
    width: 20,
    total: totalLength,
    renderThrottle: 0,
    clear: false,
    callback: function importCompleted() {  // Method which will display type of Animal
      if (counter.created > 0) {
        console.log(`${counter.created} note(s) created in [${notebookName}], ${counter.updated} note(s) updated.`);
      } else {
        console.log(`${counter.created} note(s) created, ${counter.updated} note(s) updated.`);
      }
    },
  });
}
function getSyncEntryDirPath(dirPath) {
  return `${dirPath}/${SYNC_DIR_NAME}`;
}
function getSyncEntryDirPathOld(dirPath) {
  return `${dirPath}/${SYNC_DIR_NAME_OLD}`;
}
function getSyncEntryFilePath(dirPath, filename) {
  return `${getSyncEntryDirPath(dirPath)}/.${filename}.json`;
}
function shouldByPass(dirPath, filename, entry) {
  const fs = require('fs');
  const md5file = require('md5-file');
  const evernote = require('evernote-jxa');
  const syncEntryDirPath = getSyncEntryDirPath(dirPath);
  if (!fs.existsSync(syncEntryDirPath)) fs.mkdirSync(syncEntryDirPath);
  const syncEntryFilePath = getSyncEntryFilePath(dirPath, filename);
  const syncEntryFileExist = fs.existsSync(syncEntryFilePath);
  if (!syncEntryFileExist) return false;
  const syncEntry = JSON.parse(fs.readFileSync(syncEntryFilePath).toString());
  if (!syncEntry.noteId || !evernote.findNote(syncEntry.noteId.trim())) return false;
  const originalMd5 = syncEntry.md5;
  const latestMd5 = md5file.sync(`${dirPath}/${filename}`);
  if (originalMd5 !== latestMd5) {
    // delete old note
    entry.md5 = syncEntry.md5;
    const nbName = evernote.deleteNote(syncEntry.noteId.trim());
    if (nbName) entry.notebook = nbName;
  }
  return originalMd5 === latestMd5;
}
function barTick(bar, filename) {
  const cliTruncate = require('cli-truncate');
  const trailingStr = (bar.curr + 1 === bar.total) ? '' : cliTruncate(filename, 40, { position: 'middle' }); // eslint-disable-line object-curly-spacing
  bar.tick(1, {
    'filename': trailingStr,
  });
}

/*
* Entry: {withText: 'blabla', title: 'blabla', notebook: 'name', tags:['rootDir', 'parentDir'], attachments:['/tm/file']}
*/
function doImportFiles(bar, entries, rootDirName, notebookName, counter) {
  const evernote = require('evernote-jxa');
  const junk = require('junk');
  const fs = require('fs');

  require('async-foreach').forEach(entries, function doImportFile(fileEntry) {
    const filename = fileEntry.filename;
    const dirPath = fileEntry.dirPath;
    if (junk.is(filename)) return;
    if (/^\./.test(filename)) return;
    const syncEntry = initSyncEntry(dirPath, filename, notebookName, rootDirName);
    if (shouldByPass(dirPath, filename, syncEntry)) {
      barTick(bar, filename);
    } else {
      syncEntry.md5 ? ++counter.updated : ++counter.created;
      const paramsFilePath = preparePrarmsFile(syncEntry);
      try {
        evernote.createNotebook(syncEntry.notebook);
        syncEntry.noteId = evernote.createNote(paramsFilePath);
        completeSyncEntry(syncEntry);
        barTick(bar, filename);
      } catch (e) {
        console.log(e);
      } finally {
        fs.unlinkSync(paramsFilePath);
      }
    }
    const done = this.async(); // eslint-disable-line no-invalid-this
    setTimeout(done, 1);
  });
}
function initSyncEntry(dirPath, filename, notebookName, rootDirName) {
  const path = require('path');
  const entry = {};
  entry['SyncEntry'] = getSyncEntryFilePath(dirPath, filename);
  entry['withText'] = filename + '\n';
  entry['title'] = filename;
  entry['notebook'] = notebookName;
  entry['attachments'] = [`${dirPath}/${filename}`];
  // entry['tags'] = [rootDirName, dirPath.split(path.sep).pop()];
  entry['tags'] = [rootDirName];
  let pathArr = dirPath.split(path.sep);
  let tag = null;
  while (tag = pathArr.pop()) {
    if (tag === rootDirName) {
      break;
    } else {
      entry['tags'].push(tag);
    }
  }
  return entry;
}
function completeSyncEntry(entry) {
  const fs = require('fs');
  entry.syncDate = new Date();
  entry.md5 = require('md5-file').sync(entry.attachments[0]);
  const fd = fs.openSync(entry.SyncEntry, 'w');
  fs.writeSync(fd, JSON.stringify(entry, null, '    '));
  fs.closeSync(fd);
}
function updateSyncDirName(dirPath) {
  const fs = require('fs');
  const oldPath = getSyncEntryDirPathOld(dirPath);
  const syncEntryDirPath = getSyncEntryDirPath(dirPath);
  if (fs.existsSync(oldPath)) fs.renameSync(oldPath, syncEntryDirPath);
}
function importFiles(dirPath, notebookName) {
  const path = require('path');
  const entries = [];
  writeLineConsole('Calculating...');
  const count = countDir(dirPath, entries);
  clearLineConsole();
  const counter = { 'created': 0, 'updated': 0 }; // eslint-disable-line

  const rootDirName = dirPath.split(path.sep).pop();
  if (!notebookName) notebookName = `${rootDirName}: ${new Date().toDateString()}`;
  const bar = initProgressBar(count, notebookName, counter);
  doImportFiles(bar, entries, rootDirName, notebookName, counter);
}
function preparePrarmsFile(entry) {
  const uuidV4 = require('uuid/v4');
  const fs = require('fs');
  const os = require('os');
  const paramsFilePath = `${os.tmpdir()}/${uuidV4()}.json`;
  fs.writeFileSync(paramsFilePath, JSON.stringify(entry));
  return paramsFilePath;
}
function writeLineConsole(str) {
  process.stdout.write(str);
}
function clearLineConsole() {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
}
function countDir(dirPath, entries) {
  const junk = require('junk');
  const fs = require('fs');
  const dir = fs.readdirSync(dirPath);
  let count = 0;
  updateSyncDirName(dirPath);
  dir.forEach(function examFile(filename) {
    if (junk.is(filename)) return;
    if (/^\./.test(filename)) return;
    if (fs.lstatSync(`${dirPath}/${filename}`).isDirectory()) {
      count += countDir(`${dirPath}/${filename}`, entries);
    } else {
      count++;
      // const entry = {};
      // entry.dirPath = dirPath;
      // entry.filename = filename;
      entries.push({dirPath, filename});
    }
  });
  return count;
}

function main(argv) {
  require('pkginfo')(module, 'version');
  const program = require('commander');
  program
    .version(module.exports.version)
    .option('-n, --notebook <notebook>', 'Target Notebook Name, a local notebook will be created if not specified.')
    .arguments('<path>')
    .parse(argv);
  if (!program.args.length) program.help();
  const dirPath = program.args[0];
  importFiles(dirPath, program.notebook);
}

if (typeof require != 'undefined' && require.main == module) {
  main(process.argv);
}
