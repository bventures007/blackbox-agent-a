# Add an idea in plain language

Copy FEATURE-BRIEF.txt to a new, descriptively named file in this directory and fill it in. Write the brief in English; no framework or infrastructure code is needed. Include English/German product copy when the feature affects the UI or landing page.

Give the agent that file as its next bounded task. It should create a scoped specification, define testable examples, reuse the connector/query/domain interfaces, and record migrations, rollout flags, tests and screenshots when relevant.

The first release remains Order-to-Cash. Ideas outside that scope remain backlog unless the owner explicitly schedules them. Missing or contradictory source data must have an explicit outcome. Test experiments in separate synthetic workspaces with flags disabled by default.
