import { synthesizeTemplate, baseConfig } from "./fixtures";

const FALCON_APP_ENTRY_POINT = [
  "/tmp/CrowdStrike/rootfs/lib64/ld-linux-x86-64.so.2",
  "--library-path",
  "/tmp/CrowdStrike/rootfs/lib64",
  "/tmp/CrowdStrike/rootfs/bin/bash",
  "/tmp/CrowdStrike/rootfs/entrypoint-ecs.sh",
];

const FALCON_INIT_ENTRY_POINT = [
  "/bin/bash",
  "-c",
  "chmod u+rwx /tmp/CrowdStrike && mkdir -p /tmp/CrowdStrike/rootfs/lib  && cp -r /bin /etc /lib64 /usr /entrypoint-ecs.sh /tmp/CrowdStrike/rootfs && chmod -R a=rX /tmp/CrowdStrike",
];

interface TaskContainer {
  Name: string;
  Image?: string;
  Essential?: boolean;
  User?: string;
  ReadonlyRootFilesystem?: boolean;
  EntryPoint?: string[];
  Command?: string[];
  DependsOn?: Array<{ Condition: string; ContainerName: string }>;
  MountPoints?: Array<{ ContainerPath: string; ReadOnly: boolean; SourceVolume: string }>;
  LinuxParameters?: { Capabilities?: { Add?: string[] } };
  Environment?: Array<{ Name: string; Value: string }>;
}

function taskContainers(stage?: string): { containers: TaskContainer[]; volumes: Array<{ Name: string }> } {
  const template = synthesizeTemplate(stage ? { stage } : {});
  const tasks = template.findResources("AWS::ECS::TaskDefinition");
  const task = Object.values(tasks)[0] as {
    Properties: { ContainerDefinitions: TaskContainer[]; Volumes: Array<{ Name: string }> };
  };
  return {
    containers: task.Properties.ContainerDefinitions,
    volumes: task.Properties.Volumes,
  };
}

describe("CrowdStrike Falcon task definition", () => {
  it("adds the shared volume, init container, and x86_64 wrapper on every app container", () => {
    const { containers, volumes } = taskContainers();
    const byName = Object.fromEntries(containers.map((container) => [container.Name, container]));

    expect(volumes).toEqual([{ Name: "crowdstrike-falcon-volume" }]);
    expect(Object.keys(byName).sort()).toEqual(["connect", "crowdstrike-falcon-init-container", "instantclient"]);

    const init = byName["crowdstrike-falcon-init-container"];
    expect(init.Essential).toBe(false);
    expect(init.User).toBe("0:0");
    expect(init.ReadonlyRootFilesystem).toBe(true);
    expect(init.Image).toBe(baseConfig.falcon.image);
    expect(init.EntryPoint).toEqual(FALCON_INIT_ENTRY_POINT);
    expect(init.MountPoints).toEqual([
      {
        ContainerPath: "/tmp/CrowdStrike",
        ReadOnly: false,
        SourceVolume: "crowdstrike-falcon-volume",
      },
    ]);
    expect(init.Command).toBeUndefined();
    expect(init.DependsOn).toBeUndefined();
    expect(init.LinuxParameters).toBeUndefined();
    expect(init.Environment).toBeUndefined();

    const expectedOpts = `--provisioning-token=${baseConfig.falcon.provisioningToken} --tags=appian-connector,master,appian-connector-master-connect --cid=${baseConfig.falcon.cid}`;
    for (const name of ["connect", "instantclient"]) {
      const container = byName[name];
      expect(container.EntryPoint).toEqual(FALCON_APP_ENTRY_POINT);
      expect(container.DependsOn).toEqual([{ Condition: "COMPLETE", ContainerName: "crowdstrike-falcon-init-container" }]);
      expect(container.MountPoints).toEqual([
        {
          ContainerPath: "/tmp/CrowdStrike",
          ReadOnly: true,
          SourceVolume: "crowdstrike-falcon-volume",
        },
      ]);
      expect(container.LinuxParameters).toEqual({ Capabilities: { Add: ["SYS_PTRACE"] } });
      expect(container.Environment).toEqual(expect.arrayContaining([{ Name: "FALCONCTL_OPTS", Value: expectedOpts }]));
    }

    expect(byName.connect.Command?.[0]).toBe("bash");
    expect(byName.connect.Command?.[1]).toBe("-c");
    expect(byName.connect.Command?.[2]).toContain("/etc/confluent/docker/run");
    expect(byName.instantclient.Command).toEqual(["bash", "-c", "sleep infinity\n"]);
    expect(byName.instantclient.Image).toBe("ghcr.io/oracle/oraclelinux8-instantclient:21");
    expect(byName.connect.User).toBe("root");
  });

  it("puts the stage in Falcon tags", () => {
    const { containers } = taskContainers("production");
    const connect = containers.find((container) => container.Name === "connect");
    const opts = connect?.Environment?.find((entry) => entry.Name === "FALCONCTL_OPTS")?.Value;
    expect(opts).toContain("--tags=appian-connector,production,appian-connector-production-connect");
  });
});
