# macpro-appian-connector: Project Brief

## Project Definition

The macpro-appian-connector is a Kafka Connector system designed to stream data changes from Appian to BigMAC. It establishes a reliable data pipeline between Appian (a legacy system) and BigMAC (presumably a more modern CMS system).

## Core Objectives

- Create a reliable, scalable data synchronization mechanism between Appian and BigMAC
- Stream data changes in real-time or near real-time to ensure data consistency
- Provide monitoring and alerting for the data pipeline
- Ensure secure handling of potentially sensitive healthcare-related data

## Key Requirements

- Connect to Appian database (Oracle) to extract data changes
- Process and transform data as needed for compatibility with target systems
- Utilize Kafka as the message streaming backbone
- Deploy as cloud-native application using serverless architecture where possible
- Implement appropriate error handling and retry mechanisms
- Provide observability through dashboards and metrics
- Support automated deployment and configuration

## Project Scope

- In scope: Data extraction from Appian, transformation, delivery to BigMAC
- Out of scope: Modifications to Appian or BigMAC internals, data governance policies

## Success Criteria

- Reliable data synchronization with minimal latency
- Complete audit trail of data changes
- Monitoring and alerting for any issues in the pipeline
- Documentation for operations and maintenance
- Ability to scale with increasing data volumes

## Stakeholders

- CMS Engineering teams
- Appian system administrators
- BigMAC system administrators
- End users who rely on synchronized data
