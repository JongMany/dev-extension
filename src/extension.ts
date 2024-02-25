// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
// import * as vscode from "vscode";
import {
  commands,
  ExtensionContext,
  StatusBarAlignment,
  type StatusBarItem,
  window,
  workspace,
} from "vscode";
import { COMMANDS } from "./commands/commands";
import StudyLogger from "./StudyLogger";

let studyLogger: StudyLogger;

export function activate(ctx: ExtensionContext) {
  studyLogger = new StudyLogger(ctx.extensionPath, ctx.globalState);
  console.log("ctx", ctx.globalState);

  ctx.globalState?.setKeysForSync(["studyLog.apiKey"]);

  if (ctx.workspaceState.get("complete") === undefined) {
    ctx.workspaceState.update("complete", {});
  }
  console.log(ctx.globalState.get("studyLog.apiKey"));

  ctx.subscriptions.push(
    commands.registerCommand(COMMANDS.API_KEY, function () {
      console.log("API_KEY");

      studyLogger.promptForApiKey();
    })
  );

  ctx.subscriptions.push(
    commands.registerCommand(COMMANDS.CODING_ACTIVITY, () => {})
  );

  ctx.subscriptions.push(studyLogger);

  studyLogger.initialize();
}

// This method is called when your extension is deactivated
export function deactivate() {
  studyLogger.dispose();
}
