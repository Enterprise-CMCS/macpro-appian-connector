# macpro-appian-connector: Active Context

## Current Work Focus

- Initial setup of Memory Bank documentation for the project
- Understanding the system architecture and components
- Documenting the core technical patterns and decisions

## Recent Changes

- Created Memory Bank documentation structure with core files:
  - projectbrief.md
  - productContext.md
  - systemPatterns.md
  - techContext.md
  - activeContext.md (this file)

## Next Steps

- Create progress.md to document the current status and remaining work
- Review the connector code in more detail to understand:
  - Query mechanism for data extraction
  - Error handling and retry logic
  - Topic configuration and naming conventions
- Investigate test coverage and potential improvements
- Review deployment and operations documentation

## Active Decisions

- Using a structured Memory Bank approach for maintaining project context
- Focusing on understanding the core components before making changes

## Architectural Patterns

- Event-driven architecture with Kafka as the backbone
- Microservices approach with Lambda functions for orchestration
- Configuration as code for connector definitions
- ECS for containerized Connect workers
- CloudWatch for centralized monitoring

## Code Patterns & Preferences

- JavaScript/TypeScript as primary languages
- Serverless framework for infrastructure as code
- Retry mechanisms for resilience
- Service discovery for component communication

## Recent Insights

- The system uses a JDBC connector to extract data from Oracle database
- Changes are tracked using timestamp and incremental columns
- The connector is configured to poll the database at regular intervals (2000ms)
- Lambda functions are used to manage the connector lifecycle
- The project appears to follow AWS best practices for serverless applications
- The connector is part of a larger CMS ecosystem connecting legacy and modern systems

## Current Challenges

- Understanding the complete data flow from Appian to BigMAC
- Identifying potential performance bottlenecks in the current implementation
- Determining test coverage and quality assurance procedures
- Understanding operational procedures for troubleshooting

## Resources & References

- Project documentation in the `docs/` directory
- Architecture diagram in `docs/assets/architecture.png`
- Development metrics available at deployment URL
- AWS resource listing available at deployment URL
