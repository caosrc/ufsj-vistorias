self.onmessage = function (e) {
  const { cells, iteracoes = 5 } = e.data

  // ── 1. transferência de água pelo D8 ────────────────────────
  for (let iter = 0; iter < iteracoes; iter++) {
    const sorted = [...cells].sort((a, b) => b.elev - a.elev)
    sorted.forEach(cell => {
      if (!cell.fluxo || cell.acumulado <= 0) return
      const deltaH = Math.max(0, cell.elev - cell.fluxo.elev)
      const slope  = deltaH / 1443
      const vel    = Math.sqrt(Math.max(slope, 0.001)) * 3
      const trans  = cell.acumulado * (vel / 10) * 0.6
      const idx    = cells.findIndex(c => c.row === cell.fluxo.row && c.col === cell.fluxo.col)
      if (idx >= 0) {
        cells[idx].acumulado += trans
        cell.acumulado       -= trans * 0.4
      }
    })
  }

  // ── 2. acumulação de fluxo (FA) — quantas células drenam aqui
  // FA alto = canal natural = zona de inundação
  const faMap = new Map()
  cells.forEach(c => faMap.set(`${c.row},${c.col}`, 1))

  // processa do mais alto para o mais baixo
  const sorted = [...cells].sort((a, b) => b.elev - a.elev)
  sorted.forEach(cell => {
    if (!cell.fluxo) return
    const keyOrig = `${cell.row},${cell.col}`
    const keyDest = `${cell.fluxo.row},${cell.fluxo.col}`
    const faOrig  = faMap.get(keyOrig) || 1
    faMap.set(keyDest, (faMap.get(keyDest) || 1) + faOrig)
  })

  cells.forEach(c => {
    c.fa = faMap.get(`${c.row},${c.col}`) || 1
  })

  // ── 3. classificar risco de inundação por célula ─────────────
  const maxFA  = Math.max(...cells.map(c => c.fa))
  const maxAcum = Math.max(...cells.map(c => c.acumulado))

  cells.forEach(c => {
    const normFA   = c.fa / Math.max(maxFA, 1)
    const normAcum = c.acumulado / Math.max(maxAcum, 1)
    // risco combinado: acumulação D8 + área contribuinte
    c.risco = (normFA * 0.55 + normAcum * 0.45)
    // célula é depressão se não tem fluxo de saída ou elev muito baixa
    c.depressao = !cell_has_downslope(c, cells)
  })

  self.postMessage(cells)
}

function cell_has_downslope(cell, cells) {
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
  return dirs.some(([dr, dc]) => {
    const v = cells.find(v => v.row === cell.row + dr && v.col === cell.col + dc)
    return v && v.elev < cell.elev
  })
}
