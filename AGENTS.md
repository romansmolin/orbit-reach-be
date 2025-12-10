## Architectural guideline

- In this project we are using clean architecture, where things a divided into routes, controllers, services, repositories
- We need to use SOLID principles, especially we need think of Single Responsibility and Dependency Inversion
- We need to follow KISS and DRY principles, code should be redable and do not repeat itself. In case we see a pattern, we create a reusable function and put it in shared folder.
- Variables names should clearly describe the main idea of variable or function.
- Do not add comments everywhere you want, only in places where it really needed, and comments should not describe the funtcion, but either explain why we added it.
- We are using entities as I smart object in order to communicate between service and repsoitory layers.
- Keep entities simple, do not any mappin function in there. I want entities, simply be a way to transfor untype database return into expected data structures.
- Do not use ORM, we are using clean SQL queries.
- Use dependency injection, win order not rely on specific technology, but rather on interface.
- We have worker and schedulers, which are launched in the separate flow, with npm run worker.

## Technology stack

- Express.js
- PostgreSQL
- ZOD
- Axios
- Rediss
- BulMQ

## Migrations

- Any changes in our database should be described in migrations folder.
- Migration files, should be named as [index]\_[shortdescription].sql
- On the top of migration file please add date and explanation.

## Refactoring

- Do not refactor untill I specifically ask you

## Testing instructions

- Do not add tests, untill I ask you.

## CLI commands and libraries

- Before adding new dependecies, check curren package.json, it is possible that we ve already added.
