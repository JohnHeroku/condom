import {DockerfileParser, Dockerfile} from 'dockerfile-ast';
import {render} from 'mustache';
import {spawn} from 'child_process';
import {promisify} from 'util';

promisify(spawn);

export class Obfuscator {
  private ast: Dockerfile;
  private commandMappings: Map<string, number>;
  private nextNumber: number;
  constructor(private readonly source: string) {
    this.ast = DockerfileParser.parse(source);
    this.nextNumber = 0;
    this.commandMappings = new Map();
    // console.log(this.ast);
  }
  private encryptCommand(cmd: string | null): string {
    if (!cmd) {
      return '';
    } else {
      if (this.commandMappings.has(cmd)) {
        return (this.commandMappings.get(cmd) || 0).toString();
      } else {
        console.log(`${this.nextNumber}=>${cmd}`);
        this.commandMappings.set(cmd, this.nextNumber);
        return `csteps ${this.nextNumber++}`;
      }
    }
  }
  dumpEncrypted() {
    const instructions = this.ast.getInstructions();
    return instructions.map(ins => {
      if (ins.getKeyword() === 'RUN') {
        return `${ins.getKeyword()} ${this.encryptCommand(
          ins.getArgumentsContent()
        )}`;
      }
      return `${ins.getKeyword()} ${ins.getArgumentsContent()}`;
    });
  }

  private escape(input: string): string {
    return input.replace(/"/g, '\\"');
  }

  dumpC() {
    const source = `
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

int main (int argc, char *argv[]) {
    int cmd=0;
    if (argc!=2 && (cmd = atoi(argv[1])==0)) {
        printf("Error in command line args");
        return -1;
    }
    switch(cmd) {
        {{#commands}}
        case {{key}}:
            system("{{{command}}}");
        {{/commands}}
        default:
            printf("Error: unknown command %d", cmd);
            return -1;
    }
    return(0);
 } 
`;
    const view = {
      commands: Array.from(this.commandMappings, ([k, v]) => ({
        key: v,
        command: this.escape(k)
      }))
    };

    return render(source, view);
  }

  async compile(path: string): Promise<void> {
    const options = ['-xc', '-', '-o', path];
    if (process.platform !== 'darwin') {
      // Static compilation fails on mac
      options.push('-static');
      options.push('-static-libgcc');
    }
    const compiler = spawn('gcc', options);
    compiler.stdout.pipe(process.stdout);
    compiler.stderr.pipe(process.stderr);

    compiler.stdin.write(this.dumpC());
    compiler.stdin.end();

    return new Promise((resolve, reject) => {
      compiler.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          console.log('Compilation failed with error', code);
          reject(code);
        }
      });
    });
  }
}