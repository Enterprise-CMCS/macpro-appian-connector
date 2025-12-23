import * as http from "http";
import * as ecs from "./ecs-lib";
import type { ConnectorConfig, ConnectorStatus, HttpRequestParams } from "../types";

const resolver = (req: http.ClientRequest, resolve: (value: number | undefined) => void): void => {
  console.log("Finished");
  req.socket?.destroy();
  resolve(req.socket?.destroyed ? 200 : undefined);
};

export async function connectRestApiWithRetry(params: HttpRequestParams): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const retry = (e: string): void => {
      console.log("Got error: " + e);
      setTimeout(async () => {
        const result = await connectRestApiWithRetry(params);
        resolve(result);
      }, 5000);
    };

    const options: http.RequestOptions = {
      hostname: params.hostname,
      port: params.port || 8083,
      path: params.path || "",
      method: params.method || "GET",
      headers: params.headers || {
        "Content-Type": "application/json",
      },
    };

    const req = http.request(options, (res) => {
      res
        .on("data", (d: Buffer) => {
          console.log(d.toString("utf-8"));
        })
        .on("error", (error) => {
          console.log("res.on error:", error);
          retry(`${error}`);
        })
        .on("end", () => {
          resolver(req, resolve);
        });
    });

    req.on("error", (error) => {
      console.log("req.on error:", error);
      reject(error);
    });

    if (params.body) {
      req.write(JSON.stringify(params.body));
    }
    req.end();
  });
}

export async function putConnectors(
  cluster: string,
  service: string,
  connectors: ConnectorConfig[]
): Promise<void> {
  const workerIp = await ecs.findIpForEcsService(cluster, service);
  if (!workerIp) {
    throw new Error("Could not find worker IP for ECS service");
  }

  await connectRestApiWithRetry({
    hostname: workerIp,
  });

  for (const connector of connectors) {
    console.log(`Putting connector with config: ${JSON.stringify(connector, null, 2)}`);
    await connectRestApiWithRetry({
      hostname: workerIp,
      path: `/connectors/${connector.name}/config`,
      method: "PUT",
      body: connector.config,
    });
  }
}

export async function restartConnectors(
  cluster: string,
  service: string,
  connectors: ConnectorConfig[]
): Promise<void> {
  const workerIp = await ecs.findIpForEcsService(cluster, service);
  if (!workerIp) {
    throw new Error("Could not find worker IP for ECS service");
  }

  for (const connector of connectors) {
    const logConnector = {
      name: connector.name,
      tasks: connector.config["tasks.max"],
    };
    console.log(`Restarting connector: ${JSON.stringify(logConnector, null, 2)}`);
    await connectRestApiWithRetry({
      hostname: workerIp,
      path: `/connectors/${connector.name}/tasks/0/restart`,
      method: "POST",
    });
  }
}

export async function deleteConnector(ip: string, name: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const retry = (e: string): void => {
      console.log("Got error: " + e);
      setTimeout(async () => {
        const result = await deleteConnector(ip, name);
        resolve(result);
      }, 5000);
    };

    const options: http.RequestOptions = {
      hostname: ip,
      port: 8083,
      path: `/connectors/${name}`,
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    };

    const req = http.request(options, (res) => {
      console.log(`statusCode: ${res.statusCode}`);
      res
        .on("data", (d: Buffer) => {
          const data = d.toString("utf-8");
          console.log(data);
          try {
            const parsed = JSON.parse(data);
            if (parsed.message !== `Connector ${name} not found`) {
              retry(data);
              return;
            }
          } catch {
            // Response might not be JSON, continue
          }
        })
        .on("error", (error) => {
          console.log("res.on error:", error);
          retry(`${error}`);
        })
        .on("end", () => {
          resolver(req, resolve);
        });
    });

    req.on("error", (error) => {
      console.log("req.on error:", error);
      reject(error);
    });

    req.write(JSON.stringify({}));
    req.end();
  });
}

export async function deleteConnectors(
  cluster: string,
  service: string,
  connectorNames: string[]
): Promise<void> {
  const workerIp = await ecs.findIpForEcsService(cluster, service);
  if (!workerIp) {
    throw new Error("Could not find worker IP for ECS service");
  }

  for (const connectorName of connectorNames) {
    console.log(`Deleting connector: ${connectorName}`);
    await deleteConnector(workerIp, connectorName);
  }
}

export async function testConnector(ip: string, config: ConnectorConfig): Promise<ConnectorStatus> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: ip,
      port: 8083,
      path: `/connectors/${config.name}/status`,
      headers: {
        "Content-Type": "application/json",
      },
    };

    console.log("Test Kafka-connect service", options);

    const req = http.request(options, (res) => {
      console.log(`statusCode: ${res.statusCode}`);
      let responseData = "";
      
      res
        .on("data", (d: Buffer) => {
          responseData += d.toString("utf-8");
        })
        .on("error", (error) => {
          console.log("res.on error:", error);
          reject(error);
        })
        .on("end", () => {
          console.log(responseData);
          try {
            const data = JSON.parse(responseData) as ConnectorStatus;
            resolve(data);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${responseData}`));
          }
        });
    });

    req.on("error", (error) => {
      console.log("req.on error:", error);
      reject(error);
    });

    req.write(JSON.stringify({}));
    req.end();
  });
}

export async function testConnectors(
  cluster: string,
  service: string,
  connectors: ConnectorConfig[]
): Promise<ConnectorStatus[]> {
  const workerIp = await ecs.findIpForEcsService(cluster, service);
  if (!workerIp) {
    throw new Error("Could not find worker IP for ECS service");
  }

  const results = await Promise.all(
    connectors.map((connector) => {
      console.log(`Testing connector: ${connector.name}`);
      return testConnector(workerIp, connector);
    })
  );

  return results;
}

