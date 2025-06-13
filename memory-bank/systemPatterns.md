# macpro-appian-connector: System Patterns

## System Architecture

The macpro-appian-connector implements an event-driven architecture using Kafka as the messaging backbone. The system follows a microservices approach with a focus on serverless components where appropriate.

### High-Level Architecture

```mermaid
Appian (Oracle DB) → JDBC Connector → Kafka → BigMAC
                                        ↑
                       Monitoring/Alerting/Dashboard
```

The architecture leverages AWS services, with ECS for running the Kafka Connect workers and serverless functions for management, monitoring, and orchestration.

## Key Technical Decisions

### 1. Kafka Connect Framework

- **Decision**: Use Kafka Connect framework for data extraction and streaming
- **Rationale**: Provides standardized, reliable, and scalable approach to data integration
- **Implementation**: JDBC Source Connector to read from Oracle database

### 2. ECS for Connect Workers

- **Decision**: Deploy Kafka Connect workers on ECS
- **Rationale**: Provides containerized environment with appropriate resource allocation
- **Implementation**: ECS tasks with service discovery for management API

### 3. Serverless Management Layer

- **Decision**: Use AWS Lambda for connector management and orchestration
- **Rationale**: Reduces operational overhead and provides event-driven control
- **Implementation**: Lambda functions for configuration, testing, and cleanup

### 4. CloudWatch for Monitoring

- **Decision**: Utilize CloudWatch for metrics, logs, and dashboards
- **Rationale**: Native AWS integration, centralized monitoring
- **Implementation**: Custom dashboards and alarm configurations

## Design Patterns

### 1. Configuration as Code

The connector configurations are defined as code in the `connectors.js` file, allowing version-controlled, repeatable deployments.

```javascript
export const connectors = [
  {
    name: "source.jdbc.appian-connector-dbo-1",
    config: {
      "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
      // Additional configuration...
    },
  },
];
```

### 2. Retry Pattern

HTTP requests to the Connect REST API implement retry logic to handle transient failures:

```javascript
var retry = function (e) {
  console.log("Got error: " + e);
  setTimeout(async function () {
    return await connectRestApiWithRetry(params);
  }, 5000);
};
```

### 3. Service Discovery

The system uses ECS service discovery to locate the Connect workers:

```javascript
const workerIp = await ecs.findIpForEcsService(cluster, service);
```

## Component Relationships

### Primary Components

1. **JDBC Source Connector**

   - Extracts data from Appian Oracle database
   - Publishes changes to Kafka topics
   - Tracks changes using timestamp and incremental columns

2. **Connector Management Functions**

   - `configureConnectors.js`: Deploys and configures connectors
   - `testConnectors.js`: Validates connector health
   - `cleanupKafka.js`: Performs maintenance operations

3. **Monitoring & Alerting**

   - CloudWatch dashboards
   - Alarm configurations
   - Metrics collection

4. **Infrastructure**
   - ECS clusters and services
   - Kafka topics
   - Network configuration for secure access

## Critical Implementation Paths

### Connector Deployment Flow

1. Environment preparation (network, permissions, etc.)
2. Topic creation in Kafka
3. Connector configuration deployment
4. Connector testing and validation
5. Monitoring setup

### Data Flow Path

1. Change detection in Oracle (timestamp-based)
2. Data extraction via JDBC
3. Conversion to Kafka message format
4. Publishing to appropriate topic
5. Consumption by BigMAC (outside scope of this project)

### Error Handling Path

1. Error detection (Connect worker API, CloudWatch)
2. Alert generation
3. Automated retry where appropriate
4. Manual intervention for persistent issues

## Technical Constraints

- JDBC connector limitations for complex schema changes
- Network connectivity requirements between Appian DB and AWS
- Kafka message size limits
- ECS resource constraints
