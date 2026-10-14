import * as http from "http";
import * as ecs from "./ecs-lib";
import type { ConnectorConfig, ConnectorStatus, HttpRequestParams } from "../types";

const CONNECT_PORT = 8083;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5_000;

const resolver = (req: http.ClientRequest, resolve: (value: number | undefined) => void): void => {
  console.log("Finished");
  req.socket?.destroy();
  resolve(req.socket?.destroyed ? 200 : undefined);
};

function applyTimeout(req: http.ClientRequest, timeoutMs: number): void {
  req.setTimeout(timeoutMs, () => {
    req.destroy(new Error(`Request timed out after ${timeoutMs} ms`));
  });
}

export async function connectRestApiWithRetry(params: HttpRequestParams, attempt = 1): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (value: number | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const retry = (e: string): void => {
      console.log("Got error: " + e);
      if (settled) return;
      if (attempt >= MAX_ATTEMPTS) {
        settleReject(new Error(`Kafka Connect request failed after ${attempt} attempts: ${e}`));
        return;
      }
      settled = true;
      setTimeout(() => {
        connectRestApiWithRetry(params, attempt + 1).then(resolve, reject);
      }, params.retryDelayMs ?? RETRY_DELAY_MS);
    };

    const options: http.RequestOptions = {
      hostname: params.hostname,
      port: params.port || CONNECT_PORT,
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
          resolver(req, settleResolve);
        });
    });
    applyTimeout(req, params.timeoutMs ?? REQUEST_TIMEOUT_MS);

    req.on("error", (error) => {
      console.log("req.on error:", error);
      settleReject(error);
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

export async function testConnector(
  ip: string,
  config: ConnectorConfig,
  port = CONNECT_PORT,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<ConnectorStatus> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: ip,
      port,
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
          try {
            const data = JSON.parse(responseData) as ConnectorStatus;
            console.log(
              "Kafka connector status",
              JSON.stringify({
                name: data.name,
                connectorState: data.connector?.state,
                tasks: (data.tasks ?? []).map((task) => ({ id: task.id, state: task.state })),
              })
            );
            resolve(data);
          } catch (e) {
            reject(new Error("Failed to parse connector status response"));
          }
        });
    });

    applyTimeout(req, timeoutMs);

    req.on("error", (error) => {
      console.log("req.on error:", error);
      reject(error);
    });

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

