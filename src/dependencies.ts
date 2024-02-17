// import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as which from "which";

export class Dependencies {
  // private options: Options;
  // private logger: Logger;
  private resourcesLocation: string;
  private cliLocation?: string = undefined;
  private cliLocationGlobal?: string = undefined;

  constructor(resourcesLocation: string) {
    this.resourcesLocation = resourcesLocation;
  }

  public getCliLocation(): string {
    if (this.cliLocation) {
      return this.cliLocation;
    }

    this.cliLocation = this.getCliLocationGlobal();
    if (this.cliLocation) {
      return this.cliLocation;
    }

    let osname = os.platform() as string;
    if (osname === "win32") {
      osname = "windows";
    }
    const arch = this.architecture();
    const ext = os.platform() === "win32" ? ".exe" : "";
    const binary = `wakatime-cli-${osname}-${arch}${ext}`;
    this.cliLocation = path.join(this.resourcesLocation, binary);

    return this.cliLocation;
  }

  public getCliLocationGlobal(): string | undefined {
    if (this.cliLocationGlobal) {
      return this.cliLocationGlobal;
    }

    const binaryName = `wakatime-cli${os.platform() === "win32" ? ".exe" : ""}`;
    const path = which.sync(binaryName, { nothrow: true });
    if (path) {
      this.cliLocationGlobal = path;
      // this.logger.debug(`Using global wakatime-cli location: ${path}`);
    }

    return this.cliLocationGlobal;
  }
  private architecture(): string {
    const arch = os.arch();
    if (arch.indexOf("32") > -1) {
      return "386";
    }
    if (arch.indexOf("x64") > -1) {
      return "amd64";
    }
    return arch;
  }
}
