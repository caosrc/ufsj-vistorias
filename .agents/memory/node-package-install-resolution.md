---
name: Resolução da instalação de pacotes Node
description: Comportamento observado do instalador de pacotes do workspace ao receber dependências com faixas semver.
---

Ao instalar pacotes Node através do instalador do workspace, faixas semver existentes podem ser resolvidas para versões mais novas permitidas e gravadas novamente no manifesto e no lockfile, em vez de apenas materializar o conjunto já travado.

**Why:** Uma instalação feita apenas para habilitar a compilação atualizou várias entradas de dependências e regenerou grande parte do lockfile.

**How to apply:** Depois de instalar dependências para verificação, revise os manifests e lockfiles; mantenha as faixas originalmente declaradas se a atualização de versões não fizer parte da tarefa.
