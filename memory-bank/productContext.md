# macpro-appian-connector: Product Context

## Purpose & Problem Statement

The macpro-appian-connector exists to solve a critical data integration challenge within the CMS ecosystem. Appian, as a legacy system, contains valuable data that needs to be accessible and usable in BigMAC (presumably a more modern CMS system). Without this connector, data would exist in isolated silos, leading to inconsistencies, manual data entry requirements, and potential errors.

## User Needs & Benefits

- **Data Consistency**: Users need to see the same data in both systems without manual synchronization
- **Timeliness**: Critical data changes need to propagate quickly to support operational decisions
- **Reliability**: The data pipeline must be dependable to maintain trust in the system
- **Transparency**: Users should have visibility into the data flow and synchronization status

## System Functionality

The system functions as a data bridge that:

1. Connects to the Appian Oracle database using JDBC
2. Monitors specific tables/views for data changes using timestamp and incremental ID tracking
3. Captures these changes and publishes them to Kafka topics
4. Manages connector configuration and health
5. Provides monitoring and alerting for the data pipeline

## User Experience Goals

While this is primarily a backend integration system without direct user interfaces, it does impact the experience of:

- **System Administrators**: Who need simple deployment, clear monitoring, and straightforward troubleshooting
- **Data Consumers**: Who rely on timely and accurate data propagation
- **Developers**: Who need to understand the data flow for building downstream systems

The connector should be "invisible" when working correctly - users should simply trust that data is flowing appropriately between systems.

## Integration Context

The connector sits within a larger ecosystem of CMS applications:

- **Upstream**: Appian application and its Oracle database
- **Connector Layer**: This Kafka-based integration service
- **Downstream**: BigMAC and potentially other consuming systems
- **Supporting Systems**: Monitoring, alerting, and operational dashboards

## Success Criteria from User Perspective

- Data appears in BigMAC shortly after being changed in Appian
- Administrators receive timely alerts about any synchronization issues
- The connector requires minimal maintenance and manual intervention
- The system scales appropriately with data volume increases
- Clear documentation exists for troubleshooting and system understanding
