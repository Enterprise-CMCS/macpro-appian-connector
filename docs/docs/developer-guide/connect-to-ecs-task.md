---
layout: default
title: Connect to an ECS Container
parent: Development Workflows
nav_order: 6
---

# Connect to an ECS Container
{: .no_toc }

How-to to remote onto any ECS container deployed by seatool-connectors.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

- TOC
{:toc}

---

### Connect to an ECS Container

#### Summary
These instructions should be followed anytime you'd like to remote onto, or port forward to, a running ECS Container.  Direct access to the running containers is often helpful in development or debugging efforts.
No matter what task or container to which you're trying to connect, the command you run will be of the same format.  It's just the arguments that differ.

#### Prerequisites:
- Completed all [onboarding]({{ site.baseurl }}{% link docs/onboarding/onboarding.md %})

#### Procedure
- [Obtain and set AWS CLI credentials]({{ site.baseurl }}{%link docs/development-workflows/aws-auth.md %})
- Determine the stage to which you wish to connect.  This could be master, or it could be a development stage, such as 'mystage'.
- Determine the service that deploys the container to which you want to connect.  Since this repository only has one container that's deployed, this question's answer is simple:  you want to connect to the 'connector' service.
- Use the run script's top level 'connect' command to obtain the connection string:
  ```bash
    cd seatool-connectors
    run connect --service [servicename] --stage [stagename]
  ```
  If the connector ECS task is running, this will output connection commands.  Read the outputted commands and find the one you want.
- Copy the command outputted by the above step, paste it into your terminal, and hit Enter.
- The command(s) that call 'aws ecs' will put you onto the connector task in a termianl.  You may interact with the Kafka Connect REST API as follows:
```bash
  curl http://localhost:8083/connectors | python -m json.tool
``` 
When you want to exit the container, simply run `exit`.  You will be automatically exited after a certain time period of no activity.
- The command(s) that begin with 'ecs-exec-pf' are used for port forwarding, which after running enable you to interact with localhost:8083 on your local machine.

#### Notes
- The procedure asks you to copy and paste a command, rather than simply running it, due to some odd shell behavior.  If I remember correctly, if the script automatically ran the command, any error in something you execute would cause you to get kicked off the ECS task.  This can and should be revisited.  I don't like the copy and paste step.
