import * as childProcess from "child_process";
import {
  Disposable,
  Position,
  StatusBarAlignment,
  StatusBarItem,
  TaskStartEvent,
  TextDocument,
  Uri,
  tasks,
  version,
  window,
  workspace,
} from "vscode";
import { Utils } from "./utils";
import { Dependencies } from "./dependencies";

type FileSelection = {
  selection: Position;
  lastHeartbeatAt: number;
};

type FileSelectionMap = {
  [key: string]: FileSelection;
};

export default class StudyLogger {
  private statusBar?: StatusBarItem = undefined;
  private disposable: Disposable = Disposable.from();
  private lastHeartbeat: number = 0;
  private lastFile: string = "";
  private debounceMs = 50;
  private dedupe: FileSelectionMap = {};
  private debounceTimeoutId: any = null;
  private dependencies: Dependencies;
  private fetchTodayInterval: number = 60000;
  private lastFetchToday: number = 0;
  // private showStatusBar: boolean = true;
  private showCodingActivity: boolean = false;

  constructor(public extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  initialize() {
    this.statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 4);
    this.statusBar.command = "study-log.showLog";
    this.statusBar.text = "⏳Time";
    this.statusBar.tooltip = "Check Your Programming Time";
    this.statusBar.show();
    console.log("statusBar");
    this.dependencies = new Dependencies(this.extensionPath);
    this.setupEventListeners();
  }

  private setupEventListeners() {
    let subscriptions: Disposable[] = [];
    window.onDidChangeTextEditorSelection(this.onChange, this, subscriptions);
    window.onDidChangeActiveTextEditor(this.onChange, this, subscriptions);
    workspace.onDidSaveTextDocument(this.onSave, this, subscriptions);

    tasks.onDidStartTask(this.onDidStartTask, this, subscriptions);
    tasks.onDidEndTask(this.onDidEndTask, this, subscriptions);

    this.disposable = Disposable.from(...subscriptions);
  }

  private onChange() {
    console.log("change");

    this.onEvent(false);
  }

  private onSave() {
    console.log("save");
    this.onEvent(true);
  }

  private onDidStartTask(e: TaskStartEvent): void {
    console.log("start Task");
    if (e.execution.task.isBackground) {
      return;
    }
    if (
      e.execution.task.detail &&
      e.execution.task.detail.indexOf("watch") !== -1
    ) {
      return;
    }
    // this.isCompiling = true;
    this.onEvent(false);
  }

  private onDidEndTask(): void {
    // this.isCompiling = false;
    console.log("end Task");
    this.onEvent(false);
  }

  private onEvent(isWrite: boolean) {
    clearTimeout(this.debounceTimeoutId);
    this.debounceTimeoutId = setTimeout(() => {
      let editor = window.activeTextEditor;
      if (editor) {
        let doc = editor.document;
        if (doc) {
          let file = doc.fileName;
          let time: number = Date.now();

          if (isWrite || this.lastFile !== file) {
            this.sendHeartbeat(doc, time, editor.selection.start, isWrite);
            this.lastFile = file;
            this.lastHeartbeat = time;
          }
        }
      }

      if (isWrite) {
        console.log("isWrite", window.activeTextEditor?.document);

        // this.statusBar?.show();
      }
    }, this.debounceMs);
  }

  sendHeartbeat(
    doc: TextDocument,
    time: number,
    selection: Position,
    isWrite: boolean
  ) {
    this._sendHeartbeat(doc, time, selection, isWrite);
  }

  private _sendHeartbeat(
    doc: TextDocument,
    time: number,
    selection: Position,
    isWrite: boolean
  ) {
    let file = doc.fileName;
    if (Utils.isRemoteUri(doc.uri)) {
      file = `${doc.uri.authority}${doc.uri.path}`;
      file = file.replace("ssh-remote+", "ssh://");
    }

    let args: string[] = [];
    args.push("--entity", Utils.quote(file));
    // TODO: CHECK THIS (INITIALIZE METHOD 확인)
    // let user_agent =
    // `${this.agentName}/${version} vscode-wakatime}/${this.extension.version}`;

    // args.push("--plugin", Utils.quote(user_agent));
    args.push("--lineno", String(selection.line + 1));
    args.push("--cursorpos", String(selection.character + 1));
    args.push("--lines-in-file", String(doc.lineCount));
    if (Utils.isPullRequest(doc.uri)) {
      args.push("--pr", "code reviewing");
    }
    const project = this.getProjectName(doc.uri);
    if (project) {
      args.push("--alternate-project", Utils.quote(project));
    }

    const folder = this.getProjectFolder(doc.uri);
    if (folder) {
      args.push("--project-folder", Utils.quote(folder));
    }

    if (isWrite) {
      args.push("--write");
    }
    const binary = this.dependencies.getCliLocation();

    // const options = Desktop.buildOptions();
    let proc = childProcess.execFile(binary, args, (error, stdout, stderr) => {
      // if (error) {
      //   if (stderr && stderr.toString() !== '') this.logger.error(stderr.toString());
      //   if (stdout && stdout.toString() !== '') this.logger.error(stdout.toString());
      //   this.logger.error(error.toString());
      // }
    });

    proc.on("close", (code, _signal) => {
      if (code === 0) {
        // if (this.showStatusBar) {
        this.getCodingActivity();
        // }
      }
    });
  }

  private isDuplicateHeartbeat(
    file: string,
    time: number,
    selection: Position
  ): boolean {
    let duplicate = false;
    let minutes = 30;
    let milliseconds = minutes * 60000;
    if (
      this.dedupe[file] &&
      this.dedupe[file].lastHeartbeatAt + milliseconds < time &&
      this.dedupe[file].selection.line === selection.line &&
      this.dedupe[file].selection.character === selection.character
    ) {
      duplicate = true;
    }
    this.dedupe[file] = {
      selection: selection,
      lastHeartbeatAt: time,
    };
    return duplicate;
  }

  // 종료시키는 것.
  dispose() {
    console.log("dispose");

    this.disposable.dispose();
    this.statusBar?.dispose();
  }

  private getCodingActivity() {
    // if(!this.showStatusBar) return;

    const cutoff = Date.now() - this.fetchTodayInterval;

    if (this.lastFetchToday > cutoff) {
      return;
    }

    this.lastFetchToday = Date.now();

    // this.options.getApiKey((apiKey) => {
    // if (!apiKey) return;
    this._getCodingActivity();
    // });
  }

  // TODO:
  private _getCodingActivity() {
    let args = [
      "--today",
      "--output",
      "json",
      "--plugin",
      // Utils.quote(user_agent),
    ];

    const binary = this.dependencies.getCliLocation();
    const options = {};
    try {
      let proc = childProcess.execFile(
        binary,
        args,
        options,
        (error, stdout, stderr) => {
          if (error) {
            // if (stderr && stderr.toString() != '') this.logger.debug(stderr.toString());
            // if (stdout && stdout.toString() != '') this.logger.debug(stdout.toString());
            // this.logger.debug(error.toString());
          }
        }
      );
      let output = "";
      if (proc.stdout) {
        proc.stdout.on("data", (data: string | null) => {
          if (data) {
            output += data;
            console.log("output", output);
          }
        });
      }
      proc.on("close", (code, _signal) => {
        if (code === 0) {
          // if (this.showStatusBar) {
          if (output) {
            let jsonData: any;
            try {
              jsonData = JSON.parse(output);
            } catch (e) {
              // this.logger.debug(
              // `Error parsing today coding activity as json:\n${output}\nCheck your ${this.options.getLogFile()} file for more details.`,
              // );
            }
            // if (jsonData) this.hasTeamFeatures = jsonData?.has_team_features;
            if (jsonData?.text) {
              if (this.showCodingActivity) {
                this.updateStatusBarText(jsonData.text.trim());
                /* this.updateStatusBarTooltip(
                  "WakaTime: Today’s coding time. Click to visit dashboard."
                ); */
              } else {
                this.updateStatusBarText();
                // this.updateStatusBarTooltip(jsonData.text.trim());
              }
            } else {
              this.updateStatusBarText();
              /* this.updateStatusBarTooltip(
                "WakaTime: Calculating time spent today in background..."
              ); */
            }
            // this.updateTeamStatusBar();
          } else {
            this.updateStatusBarText();
            /* this.updateStatusBarTooltip(
              "WakaTime: Calculating time spent today in background..."
            ); */
            // }
          }
        } else if (code === 102 || code === 112) {
          // noop, working offline
        } else {
          // this.logger.debug(
          // `Error fetching today coding activity (${code}); Check your ${this.options.getLogFile()} file for more details.`,
          // );
        }
      });
    } catch (err) {
      console.error("error", err);
    }
  }

  private updateStatusBarText(text?: string): void {
    if (!this.statusBar) {
      return;
    }
    if (!text) {
      this.statusBar.text = "$(clock)";
    } else {
      this.statusBar.text = "$(clock) " + text;
    }
  }

  private getProjectName(uri: Uri) {
    if (!workspace) {
      return;
    }
    const workspaceFolder = workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      try {
        return workspaceFolder.name;
      } catch (err) {
        console.error(err);
      }
    }
    if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
      return workspace.workspaceFolders[0].name;
    }

    return workspace.name || "";
  }

  private getProjectFolder(uri: Uri): string {
    if (!workspace) {
      return "";
    }
    const workspaceFolder = workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      try {
        return workspaceFolder.uri.fsPath;
      } catch (e) {}
    }
    if (workspace.workspaceFolders && workspace.workspaceFolders.length) {
      return workspace.workspaceFolders[0].uri.fsPath;
    }
    return "";
  }
}
