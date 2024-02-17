import { Uri } from "vscode";

export class Utils {
  public static isRemoteUri(uri: Uri): boolean {
    if (!uri) {
      return false;
    }
    return uri.scheme === "vscode-remote";
  }

  public static isPullRequest(uri: Uri): boolean {
    if (!uri) {
      return false;
    }
    return uri.scheme === "pr";
  }

  public static quote(str: string): string {
    if (str.includes(" ")) {
      return `"${str.replace('"', '\\"')}"`;
    }
    return str;
  }
}
