import yargs from "yargs";
import * as dotenv from "dotenv";
import LabeledProcessRunner from "./runner";
import * as fs from "fs";
import { ServerlessStageDestroyer } from "@stratiformdigital/serverless-stage-destroyer";
import { ServerlessRunningStages } from "@enterprise-cmcs/macpro-serverless-running-stages";
import { SecurityHubJiraSync } from "@enterprise-cmcs/macpro-security-hub-sync";

// load .env
dotenv.config();

const runner = new LabeledProcessRunner();

function touch(file: string) {
  try {
    const time = new Date();
    fs.utimesSync(file, time, time);
  } catch (err) {
    fs.closeSync(fs.openSync(file, "w"));
  }
}

async function frozenInstall(runner: LabeledProcessRunner, dir: string) {
  await runner.run_command_and_output(
    `${dir.split("/").slice(-1)} deps`,
    ["yarn", "install", "--frozen-lockfile"],
    dir
  );
}

async function install_deps(runner: LabeledProcessRunner, dir: string) {
  if (process.env.CI == "true") {
    if (!fs.existsSync(`${dir}/node_modules`)) {
      await frozenInstall(runner, dir);
    }
  } else {
    if (
      !fs.existsSync(`${dir}/.yarn_install`) ||
      fs.statSync(`${dir}/.yarn_install`).ctimeMs <
        fs.statSync(`${dir}/yarn.lock`).ctimeMs
    ) {
      await frozenInstall(runner, dir);
      touch(`${dir}/.yarn_install`);
    }
  }
}

async function install_deps_for_services() {
  const services = getDirectories("src/services");
  for (const service of services) {
    await install_deps(runner, `src/services/${service}`);
  }
  await install_deps(runner, "src/libs");
}

function getDirectories(path: string) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path + "/" + file).isDirectory();
  });
}

async function buildInfra() {
  await runner.run_command_and_output(
    `CDK Build`,
    ["yarn", "build"],
    "infra"
  );
}

yargs(process.argv.slice(2))
  .command("install", "install all service dependencies", {}, async () => {
    await install_deps_for_services();
  })
  .command(
    "deploy",
    "deploy the project using AWS CDK",
    {
      stage: { type: "string", demandOption: true },
    },
    async (options) => {
      await install_deps_for_services();
      await buildInfra();

      // Deploy both stacks with CDK
      // Stack names follow pattern: appian-{service}-{stage}
      const stacks = [
        `appian-alerts-${options.stage}`,
        `appian-connector-${options.stage}`,
      ];

      await runner.run_command_and_output(
        `CDK Deploy`,
        [
          "cdk",
          "deploy",
          ...stacks,
          "--require-approval",
          "never",
        ],
        "infra"
      );
    }
  )
  .command(
    "test",
    "run any available tests.",
    {
      stage: { type: "string", demandOption: true },
    },
    async (options) => {
      await install_deps_for_services();
      await runner.run_command_and_output(
        `Unit Tests`,
        ["yarn", "test-ci"],
        "."
      );
      console.log(`Tests completed for stage: ${options.stage}`);
    }
  )
  .command("test-gui", "open unit-testing gui for vitest.", {}, async () => {
    await install_deps_for_services();
    await runner.run_command_and_output(
      `Unit Tests`,
      ["yarn", "test-gui"],
      "."
    );
  })
  .command(
    "destroy",
    "destroy a stage in AWS",
    {
      stage: { type: "string", demandOption: true },
      service: { type: "string", demandOption: false },
      wait: { type: "boolean", demandOption: false, default: true },
      verify: { type: "boolean", demandOption: false, default: true },
    },
    async (options) => {
      const destroyer = new ServerlessStageDestroyer();
      const filters = [
        {
          Key: "PROJECT",
          Value: "appian",
        },
      ];
      if (options.service) {
        filters.push({
          Key: "SERVICE",
          Value: `${options.service}`,
        });
      }
      await destroyer.destroy("us-east-1", options.stage, {
        wait: options.wait,
        filters: filters,
        verify: options.verify,
      });
    }
  )
  .command(
    "connect",
    "Prints a connection string that can be run to 'ssh' directly onto the ECS Fargate task",
    {
      stage: { type: "string", demandOption: true },
      cluster: { type: "string", demandOption: false, default: "appian-connector" },
    },
    async (options) => {
      const clusterName = `${options.cluster}-${options.stage}-connect`;
      console.log(`\nTo connect to the ECS task, run:\n`);
      console.log(`aws ecs execute-command \\`);
      console.log(`  --cluster ${clusterName} \\`);
      console.log(`  --task $(aws ecs list-tasks --cluster ${clusterName} --query 'taskArns[0]' --output text) \\`);
      console.log(`  --container kafka-connect \\`);
      console.log(`  --interactive \\`);
      console.log(`  --command "/bin/bash"\n`);
    }
  )
  .command(
    "base-update",
    "this will update your code to the latest version of the base template",
    {},
    async () => {
      const addRemoteCommand = [
        "git",
        "remote",
        "add",
        "base",
        "https://github.com/Enterprise-CMCS/macpro-base-template",
      ];

      await runner.run_command_and_output(
        "Update from Base | adding remote",
        addRemoteCommand,
        ".",
        true,
        {
          stderr: true,
          close: true,
        }
      );

      const fetchBaseCommand = ["git", "fetch", "base"];

      await runner.run_command_and_output(
        "Update from Base | fetching base template",
        fetchBaseCommand,
        "."
      );

      const mergeCommand = ["git", "merge", "base/production", "--no-ff"];

      await runner.run_command_and_output(
        "Update from Base | merging code from base template",
        mergeCommand,
        ".",
        true
      );

      console.log(
        "Merge command was performed. You may have conflicts. This is normal behaivor. To complete the update process fix any conflicts, commit, push, and open a PR."
      );
    }
  )
  .command(
    ["listRunningStages", "runningEnvs", "listRunningEnvs"],
    "Reports on running environments in your currently connected AWS account.",
    {},
    async () => {
      await install_deps_for_services();
      const runningStages =
        await ServerlessRunningStages.getAllStagesForRegion("us-east-1");
      console.log(`runningStages=${runningStages.join(",")}`);
    }
  )
  .command(
    ["securityHubJiraSync", "securityHubSync", "secHubSync"],
    "Create Jira Issues for Security Hub findings.",
    {},
    async () => {
      await install_deps_for_services();
      await new SecurityHubJiraSync({
        customJiraFields: {
          customfield_14117: [{ value: "Platform Team" }],
          customfield_14151: [{ value: "Not Applicable " }],
          customfield_14068:
            "* All findings of this type are resolved or suppressed, indicated by a Workflow Status of Resolved or Suppressed.  (Note:  this ticket will automatically close when the AC is met.)",
        },
      }).sync();
    }
  )
  .strict() // This errors and prints help if you pass an unknown command
  .scriptName("run") // This modifies the displayed help menu to show 'run' isntead of 'dev.js'
  .demandCommand(1, "").argv; // this prints out the help if you don't call a subcommand
