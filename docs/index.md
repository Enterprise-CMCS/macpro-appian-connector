---
layout: default
title: Home
nav_order: 1
description: "The home page."
permalink: /
---

# {{site.title}}
{: .fs-9 }

{{ site.description }}
{: .fs-6 .fw-300 }

[View it on GitHub]({{ site.repo.url }}){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 }

---

## Welcome!

The {{ site.repo.name }} project is a Kafka Connector to stream data changes froim Appian to BigMAC. It was created using the [macpro-base-template](https://github.com/Enterprise-CMCS/macpro-base-template) a jumping off point. In addition to the Kafka Connector, this project includes full CI/CD support with GitHub Actions, automated security scanning, infrastructure and application deployment workflows, and documentation hosted in GitHub Pages.

---

## About the project

The {{ site.repo.name }} project is a work of the [Centers for Medicare & Medicaid Services (CMS)](https://www.cms.gov/).


#### Thank you to the contributors of {{ site.repo.name }}!

<ul class="list-style-none">
{% for contributor in site.github.contributors %}
  <li class="d-inline-block mr-1">
     <a href="{{ contributor.html_url }}"><img src="{{ contributor.avatar_url }}" width="32" height="32" alt="{{ contributor.login }}"/></a>
  </li>
{% endfor %}
</ul>
