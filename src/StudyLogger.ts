import * as childProcess from "child_process";
import {
  Disposable,
  Memento,
  Position,
  StatusBarAlignment,
  StatusBarItem,
  TaskStartEvent,
  TextDocument,
  Uri,
  tasks,
  window,
  workspace,
} from "vscode";
import { Utils } from "./utils";
import { Dependencies } from "./dependencies";
import fetch from "node-fetch";

type FileSelection = {
  selection: Position;
  lastHeartbeatAt: number;
};

type FileSelectionMap = {
  [key: string]: FileSelection;
};

export default class StudyLogger {
  private statusBar?: StatusBarItem = undefined;
  private apiKeyBar?: StatusBarItem = undefined;
  private disposable: Disposable = Disposable.from();
  private lastHeartbeat: number = 0;
  private lastFile: string = "";
  private debounceMs = 50;
  private dedupe: FileSelectionMap = {};
  private debounceTimeoutId: any = null;
  private dependencies: Dependencies;
  private fetchTodayInterval: number = 1000 * 60 * 30; // TODO: 1시간  => 30분으로 변경 필요 (1000->1초)
  private lastFetchToday: number = 0;
  // private showStatusBar: boolean = true;
  private isCompiling: boolean;
  private lastCompile: boolean;
  private showCodingActivity: boolean = false;
  private config: Memento;

  constructor(public extensionPath: string, config: Memento) {
    this.extensionPath = extensionPath;
    this.config = config;
  }

  initialize() {
    // API Key Bar
    this.apiKeyBar = window.createStatusBarItem(StatusBarAlignment.Right, 5);
    this.apiKeyBar.command = "studyLog.api_key";
    let defaultVal: string = this.config.get("studyLog.apiKey") || "🔑";
    this.apiKeyBar.text = defaultVal.length > 0 ? "" : "enroll Your API Key";
    this.apiKeyBar.tooltip = "Enroll Your API Key";
    this.apiKeyBar.show();

    // Status Bar
    this.statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 4);
    this.statusBar.command = "studyLog.showLog";
    this.statusBar.text = "⏳Time";
    this.statusBar.tooltip = "Check Your Programming Time";
    this.statusBar.show();
    // console.log("statusBar");
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
    this.onEvent(false);
  }

  private onSave() {
    // console.log("save");
    this.onEvent(true);
  }

  private onDidStartTask(e: TaskStartEvent): void {
    // console.log("start Task");
    if (e.execution.task.isBackground) {
      return;
    }
    if (
      e.execution.task.detail &&
      e.execution.task.detail.indexOf("watch") !== -1
    ) {
      return;
    }
    this.isCompiling = true;
    this.onEvent(false);
  }

  private onDidEndTask(e: TaskStartEvent): void {
    this.isCompiling = false;
    this.onEvent(false);
  }

  private onEvent(isWrite: boolean) {
    clearTimeout(this.debounceTimeoutId);

    this.debounceTimeoutId = setTimeout(() => {
      // console.log("onEvent");
      let editor = window.activeTextEditor;
      if (editor) {
        let doc = editor.document;
        if (doc) {
          let file = doc.fileName;
          let time: number = Date.now();

          if (
            isWrite ||
            this.lastFile !== file ||
            this.enoughTimePassed(time) ||
            this.lastCompile !== this.isCompiling
          ) {
            this.sendHeartbeat(
              doc,
              time,
              editor.selection.start,
              isWrite,
              this.isCompiling
            );
            this.lastFile = file;
            this.lastHeartbeat = time;
            this.lastCompile = this.isCompiling;
          }
        }
      }
      if (isWrite) {
        // console.log("isWrite", window.activeTextEditor?.document);
        // this.statusBar?.show();
      }
    }, this.debounceMs);
  }

  sendHeartbeat(
    doc: TextDocument,
    time: number,
    selection: Position,
    isWrite: boolean,
    isCompiling: boolean
  ) {
    const result = this.getCodingActivity();
    if (result.isProgramInProgress) {
      this._sendHeartbeat(
        doc,
        time,
        selection,
        isWrite,
        isCompiling,
        result.time as number
      );
    }
  }

  // 내부에서 getCodingActivity를 호출
  private async _sendHeartbeat(
    doc: TextDocument,
    time: number,
    selection: Position,
    isWrite: boolean,
    isCompiling: boolean,
    programmingTime: number
  ) {
    let file = doc.fileName;
    // console.log("file", file, doc.uri, doc.uri.path);

    if (Utils.isRemoteUri(doc.uri)) {
      file = `${doc.uri.authority}${doc.uri.path}`;
      file = file.replace("ssh-remote+", "ssh://");
    }

    const extensionName = file.split(".").pop();

    // prevent duplicate heartbeats
    // console.log(isWrite, this.isDuplicateHeartbeat(file, time, selection));
    // console.log(
    //   "config",
    //   this.config,
    //   this.config.get("studyLog.apiKey"),
    //   env.appHost
    // );
    if (isWrite && this.isDuplicateHeartbeat(file, time, selection)) {
      console.log("out!");
      return;
    }
    // console.log(Date.now() - this.lastFetchToday, this.lastFetchToday);

    // UTC
    const curr = new Date();
    const utc = curr.getTime() + curr.getTimezoneOffset() * 60 * 1000;

    const KR_TIME_DIFF = 9 * 60 * 60 * 1000;
    // 한국 시간(KST)은 UTC시간보다 9시간 더 빠릅니다.
    // 9시간을 밀리초 단위로 변환하였습니다.
    const kr_curr = new Date(utc + KR_TIME_DIFF).toISOString();

    const payload: any = {
      type: "file",
      entity: "file",
      extensionName: extensionName,
      docs: file.split("/").slice(1, -1),
      fileName: file.split("/").pop()?.split(".")[0],
      currentTime: kr_curr,
      lineNo: String(selection.line + 1),
      cursorPos: String(selection.character + 1),
      lines: String(doc.lineCount),
      is_write: isWrite,
      programmingTime: programmingTime,
    };

    console.log(payload, "payload");

    let args: string[] = [];

    const project = this.getProjectName(doc.uri);
    if (project) {
      // args.push("--alternate-project", Utils.quote(project));
      payload["project"] = project;
    }

    const folder = this.getProjectFolder(doc.uri);
    if (folder && file.indexOf(folder) === 0) {
      // args.push("--project-folder", Utils.quote(folder));
      payload["project_root_count"] = this.countSlashesInPath(folder);
    }

    if (isCompiling) {
      payload["category"] = "building";
    } else if (Utils.isPullRequest(doc.uri)) {
      payload["category"] = "code reviewing";
    }

    console.log(payload, "payload");
    // fetch 해야함...
    const body = { apiKey: this.config.get("studyLog.apiKey"), payload };
    // console.log(body);
    // const res = await fetch("http://localhost:8080/time/save", {
    const res = await fetch("http://43.203.82.210:8080/time/save", {
      // body: JSON.stringify(body),
      // body: JSON.stringify({ apiKey: "aaaa1111", payload }),
      body: JSON.stringify(body),
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    console.log("data", data);

    // const options = Desktop.buildOptions();
    // let proc = childProcess.execFile(binary, args, (error, stdout, stderr) => {
    // if (error) {
    //   if (stderr && stderr.toString() !== '') this.logger.error(stderr.toString());
    //   if (stdout && stdout.toString() !== '') this.logger.error(stdout.toString());
    //   this.logger.error(error.toString());
    // }
    // });

    // proc.on("close", (code, _signal) => {
    // console.log(code);

    //   if (code === 0 || code === -2) {
    //     // if (this.showStatusBar) {
    //     // console.log(code, "code");
    //     this.getCodingActivity();
    //     // }
    //   } else if (code === 102 || code === 112) {
    //   } else if (code === 103) {
    //   } else if (code === 104) {
    //   } else {
    //   }
    // });
  }

  private isDuplicateHeartbeat(
    file: string,
    time: number,
    selection: Position
  ): boolean {
    // 5분 이상 지나고 동일한 파일을 저장하는 경우는 중복으로 판단
    let duplicate = false;
    let minutes = 5;
    let milliseconds = minutes * 60000;
    try {
      // console.log(
      //   this.dedupe[file].lastHeartbeatAt &&
      //     this.dedupe[file].lastHeartbeatAt + milliseconds < time
      // );
      // console.log(
      //   (this.dedupe[file]?.lastHeartbeatAt || 0) + milliseconds,
      //   time
      // );
    } catch (err) {
      console.log("error", err);
    }

    if (
      this.dedupe[file] &&
      this.dedupe[file].lastHeartbeatAt &&
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
    // console.log("dedupe", this.dedupe, time);

    return duplicate;
  }

  // 종료시키는 것.
  dispose() {
    // console.log("dispose");

    this.disposable.dispose();
    this.statusBar?.dispose();
  }

  // 특정 시간 이상 지난 경우에 coding을 했다고 판단
  private getCodingActivity() {
    // if(!this.showStatusBar) return;

    // TODO: 이 로직을 보강해야함. (보강 완료한듯...)
    const now = Date.now();
    const programmingTime = now - this.lastFetchToday;
    const checkIsRest = programmingTime > this.fetchTodayInterval; // 휴식 중인지 판단
    // console.log(programmingTime, now, this.lastFetchToday);

    if (checkIsRest) {
      this.lastFetchToday = now;
      return { isProgramInProgress: false, time: null };
    }

    this.lastFetchToday = now;
    this._getCodingActivity();
    return { isProgramInProgress: true, time: programmingTime };
  }

  // TODO:
  // 특정 시간 이상 지난 경우, status를 변경
  private _getCodingActivity() {
    let args = [
      "--today",
      "--output",
      "json",
      "--plugin",
      // Utils.quote(user_agent),
    ];

    // console.log("_getCodingActivity");

    const binary = this.dependencies.getCliLocation();
    // console.log("binary", binary);

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
          }
        });
      }

      proc.on("close", (code, _signal) => {
        if (code === -2) {
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
            // console.log("jsonData", jsonData);
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

  private enoughTimePassed(time: number): boolean {
    return this.lastHeartbeat + 120000 < time;
  }

  private getProjectFolder(uri: Uri): string {
    if (!workspace) {
      return "";
    }
    const workspaceFolder = workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      try {
        // console.log("workspaceFolder", workspaceFolder.uri.fsPath);
        return workspaceFolder.uri.fsPath;
      } catch (e) {}
    }

    if (workspace.workspaceFolders && workspace.workspaceFolders.length) {
      return workspace.workspaceFolders[0].uri.fsPath;
    }
    return "";
  }

  private countSlashesInPath(path: string): number {
    if (!path) {
      return 0;
    }

    const windowsNetDrive = path.indexOf("\\\\") === 0;

    path = path.replace(/[\\/]+/, "/");

    if (windowsNetDrive) {
      path = "\\\\" + path.slice(1);
    }

    if (!path.endsWith("/")) {
      path = path + "/";
    }

    return (path.match(/\//g) || []).length;
  }

  public promptForApiKey(hidden: boolean = true) {
    let defaultVal: string = this.config.get("studyLog.apiKey") || "";
    let promptOptions = {
      prompt: "StudyLog API Key",
      placeHolder: "Enter your StudyLog API Key",
      value: defaultVal,
      ignoreFocusOut: true,
      password: hidden,
    };
    window.showInputBox(promptOptions).then((apiKey) => {
      console.log("apiKey", apiKey, apiKey?.length);

      if (apiKey) {
        // let invalid = promptOptions.validateInput(apiKey);
        let invalid = apiKey.length <= 0;
        if (!invalid) {
          this.config.update("studyLog.apiKey", apiKey);
          if (this.apiKeyBar) {
            this.apiKeyBar.text = "🔑";
          }
          // this.apiKeyBar?.text = "StudyLog api key updated";
          // window.setStatusBarMessage("StudyLog api key updated");
        } else {
          if (this.apiKeyBar) {
            this.apiKeyBar.text = "Invalid....";
          }
          // window.setStatusBarMessage("Invalid....");
        }
      } else {
        if (this.apiKeyBar) {
          this.config.update("studyLog.apiKey", apiKey);
          this.apiKeyBar.text = "❌";
        }
      }
    });
  }
}
