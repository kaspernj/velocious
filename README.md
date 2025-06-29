# README

This is still work in progress.

* Concurrent multi threadded web server
* Database framework ala Rails
* Database models ala Rails
* Database models that work almost the same in frontend and backend
* Migrations ala Rails
* Controllers and views ala Rails

# Setup

Make a new NPM project.
```bash
mkdir project
cd project
npm install velocious
npx velocious init
```

# Migrations

```bash
npx velocious g:migration create_tasks
```

```bash
npx velocious db:migrate
```

# Models

```bash
npx velocious g:model Option
```

# Testing

```bash
npm test
```

# Running a server

```bash
npx velocious server
```
