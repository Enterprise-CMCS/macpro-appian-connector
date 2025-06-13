# macpro-appian-connector: Technical Context

## Technology Stack

### Languages & Runtimes

- **JavaScript/TypeScript**: Primary development languages
- **Node.js**: Runtime environment for Lambda functions and tooling
- **Java**: Underlying runtime for Kafka Connect framework (managed via containers)

### Core Technologies

- **Kafka**: Message streaming platform
- **Kafka Connect**: Data integration framework
  - JDBC Source Connector: For Oracle database connectivity
- **Oracle Database**: Source system (Appian backend)

### AWS Services

- **ECS (Elastic Container Service)**: Runs Kafka Connect workers
- **Lambda**: Serverless functions for management and orchestration
- **CloudWatch**: Monitoring, logging, and dashboards
- **SNS**: Notification service for alerts
- **IAM**: Identity and access management
- **Serverless Framework**: Infrastructure as code

## Development Environment

### Prerequisites

- Node.js (version specified in `.nvmrc`)
- AWS CLI configured with appropriate permissions
- Access to AWS account for deployment
- Docker for local testing (optional)

### Local Setup

1. Clone repository
2. Run `yarn install` to install dependencies
3. Configure AWS credentials
4. Use `serverless` CLI for deployment

### Configuration Management

- Environment variables for sensitive configuration
- Configuration as code for connectors
- Serverless framework for infrastructure definition

## Technical Constraints

### External Dependencies

- **Appian System**:
  - Oracle database access required
  - Schema stability expectations
  - Network connectivity to AWS environment

### AWS Limitations

- ECS task resource limits
- Lambda execution timeouts
- CloudWatch retention policies
- VPC connectivity requirements

### Data Considerations

- Oracle database performance impact from polling
- Kafka message size limits
- Topic retention policies
- Throughput requirements based on change frequency

## Dependencies & Libraries

### Production Dependencies

- `lodash`: Utility functions
- `http`: Core module for REST API interactions
- AWS SDK modules for service interactions

### Development Dependencies

- Serverless Framework and plugins
- Testing frameworks
- Linting and code formatting tools
- CI/CD tooling

## Build & Deployment

### Build Process

1. Code linting and validation
2. Unit testing
3. Packaging for deployment
4. Infrastructure provisioning
5. Application deployment

### Deployment Strategy

- Serverless Framework manages most infrastructure
- CI/CD pipeline for automated deployments
- Environment-specific configurations
- Blue/green or progressive deployment capabilities

### Environments

- Development
- Testing/Staging
- Production

## Testing Approach

### Test Types

- Unit tests for functions
- Integration tests for connector configurations
- End-to-end tests for data flow

### Testing Tools

- Jest for JavaScript/TypeScript tests
- AWS SDK mocks for service testing
- Docker containers for local Kafka testing (if applicable)

## Monitoring & Operations

### Metrics

- CloudWatch metrics for service health
- Custom metrics for data flow and latency
- Alarm configurations for critical thresholds

### Logging

- Structured logging through CloudWatch
- Log retention policies
- Log-based alerting for errors

### Operational Procedures

- Connector restart process
- Schema change handling
- Error investigation workflow
- Scaling procedures

## Security Considerations

### Authentication & Authorization

- IAM roles and policies
- Least privilege principle
- Secrets management for database credentials

### Data Protection

- Encryption in transit
- Secure handling of potentially sensitive healthcare data
- Access controls and audit logging
