# Resource Optimization

This guide outlines the changes made to `src/services/connector/serverless.yml` for Fargate resource parameterization and the strategy for collecting metrics to optimize these settings for cost and performance across different environments (development, val, production).

## Changes Made to `serverless.yml`

- **Parameterized Fargate Resources:**
  - CPU and Memory for Fargate tasks and their constituent containers (`connect` and `instantclient`) are now parameterized using the `params` section.
  - Specific configurations are defined for `master` (dev-like), `val`, `production`, and a `default` fallback.
  - Example: `taskCpu: ${param:taskCpu}`, `connectContainerMemory: ${param:connectContainerMemory}`.
- **Corrected Production Task Memory:**
  - The `production` stage's Fargate task memory was initially set to `4GB`.
  - This has been corrected to `6144MB` (`6GB`) to adequately cover the sum of memory reservations for the `connect` (4096MB) and `instantclient` (2048MB) containers, preventing potential OOMKilled errors or task startup failures.
- **Placeholder Values:**
  - Initial placeholder values for CPU/Memory have been set for each stage. These are starting points and **must be reviewed and adjusted** based on actual performance metrics.
  - Production: Task CPU `2048`, Memory `6144MB`; `connect` CPU `2048`, Memory `4096MB`; `instantclient` Memory `2048MB`.
  - Master/Default: Task CPU `1024`, Memory `2048MB`; `connect` CPU `512`, Memory `1024MB`; `instantclient` Memory `512MB`.
  - Val: Task CPU `256`, Memory `512MB`; `connect` CPU `128`, Memory `256MB`; `instantclient` Memory `128MB`.

## Metric Collection and Optimization Strategy

The following steps should be taken to refine the Fargate resource parameters:

1. **Gather Performance Metrics (AWS CloudWatch):**

   - **Target Service:** `kafka-connect` service within the `${self:service}-${sls:stage}-connect` ECS cluster.
   - **Environments:** Collect data for `development` (e.g., `master` stage), `val`, and `production`.
   - **Key Metrics:**
     - For the ECS Service: `CPUUtilization` (average & max), `MemoryUtilization` (average & max).
     - For Fargate Tasks/Containers (via Container Insights): CPU and Memory usage for `connect` and `instantclient` containers.
   - **Timeframe:** Monitor over a representative period (e.g., 1-4 weeks) to capture typical load patterns.

2. **Analyze Collected Metrics:**

   - **Val Environment:** Expect low utilization. Aim for the smallest viable Fargate task size.
   - **Dev Environment:** Analyze average and peak usage. Can likely be smaller than production.
   - **Production Environment:** Size based on peak load, ensuring a buffer (e.g., 20-30%) for spikes.

3. **Determine Ideal CPU/Memory Values:**

   - Based on metrics, select appropriate CPU and Memory values for the task and each container per environment.
   - Refer to [valid Fargate CPU/Memory combinations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#task_size).
   - **Crucial Constraint:** Task-level `Memory` must be >= sum of container memory reservations. Task-level `Cpu` must be >= sum of container CPU reservations.

4. **Update `serverless.yml` Parameters:**

   - Modify the placeholder values in the `params` section of `src/services/connector/serverless.yml` with the new, data-driven values for each stage.

5. **Utilize AWS Compute Optimizer:**

   - Enable and review recommendations from AWS Compute Optimizer for Fargate, as it can provide data-driven sizing suggestions.

6. **Iterate and Monitor:**
   - Right-sizing is an ongoing process.
   - After applying changes, deploy and thoroughly test each environment.
   - Continuously monitor performance and costs (via AWS Cost Explorer).
   - Adjust resource allocations as needed based on evolving application demands and performance data.
