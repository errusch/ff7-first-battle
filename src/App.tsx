import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { layoutNextLine, layoutWithLines, prepareWithSegments } from '@chenglou/pretext'
import * as Tone from 'tone'

type BattlePhase = 'intro' | 'battle' | 'victory' | 'defeat'
type MenuLayer = 'root' | 'magic' | 'item' | 'target'
type ActionKind = 'attack' | 'magic' | 'item' | 'defend'
type ActorType = 'ally' | 'enemy'

type Spell = {
  id: string
  name: string
  cost: number
  power: number
  description: string
}

type InventoryItem = {
  id: string
  name: string
  amount: number
  heal: number
  description: string
}

type Combatant = {
  id: string
  name: string
  subtitle: string
  type: ActorType
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  atb: number
  speed: number
  attack: number
  magic: number
  defense: number
  alive: boolean
  defending: boolean
  spellbook: Spell[]
  isRanged?: boolean
}

type QueuedAction = {
  actorId: string
  targetId?: string
  kind: ActionKind
  spellId?: string
  itemId?: string
}

type DamagePopup = {
  id: string
  x: number
  y: number
  value: string
  hue: string
  createdAt: number
}

type VisualState = {
  flashUntil: number
  shakeUntil: number
  lungeActorId: string | null
  lungeUntil: number
  castActorId: string | null
  castUntil: number
  currentBanner: string
  bannerUntil: number
  popups: DamagePopup[]
}

const FONT = '600 16px Georgia'
const LOG_WRAP_WIDTH = 350
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const SPELLS: Record<string, Spell> = {
  bolt: {
    id: 'bolt',
    name: 'Bolt',
    cost: 4,
    power: 40,
    description: 'Lightning damage to one target.',
  },
}

const INITIAL_ITEMS: InventoryItem[] = [
  {
    id: 'potion',
    name: 'Potion',
    amount: 3,
    heal: 140,
    description: 'Restore HP to one ally.',
  },
]

function createInitialParty(): Combatant[] {
  return [
    {
      id: 'cloud',
      name: 'Cloud',
      subtitle: 'Ex-SOLDIER',
      type: 'ally',
      hp: 302,
      maxHp: 302,
      mp: 52,
      maxMp: 52,
      atb: 0,
      speed: 7.3,
      attack: 36,
      magic: 28,
      defense: 18,
      alive: true,
      defending: false,
      spellbook: [SPELLS.bolt],
    },
    {
      id: 'barret',
      name: 'Barret',
      subtitle: 'Avalanche',
      type: 'ally',
      hp: 346,
      maxHp: 346,
      mp: 18,
      maxMp: 18,
      atb: 0,
      speed: 6.4,
      attack: 34,
      magic: 10,
      defense: 20,
      alive: true,
      defending: false,
      spellbook: [],
      isRanged: true,
    },
  ]
}

function createInitialEnemies(): Combatant[] {
  return [
    {
      id: 'mp-a',
      name: 'Shinra MP α',
      subtitle: 'Security Trooper',
      type: 'enemy',
      hp: 88,
      maxHp: 88,
      mp: 0,
      maxMp: 0,
      atb: 0,
      speed: 5.4,
      attack: 22,
      magic: 0,
      defense: 10,
      alive: true,
      defending: false,
      spellbook: [],
      isRanged: true,
    },
    {
      id: 'mp-b',
      name: 'Shinra MP β',
      subtitle: 'Security Trooper',
      type: 'enemy',
      hp: 82,
      maxHp: 82,
      mp: 0,
      maxMp: 0,
      atb: 0,
      speed: 5.8,
      attack: 20,
      magic: 0,
      defense: 9,
      alive: true,
      defending: false,
      spellbook: [],
      isRanged: true,
    },
  ]
}

class AudioDirector {
  private started = false
  private initialized = false
  private sequence: Tone.Sequence<string | null> | null = null
  private bassSequence: Tone.Sequence<string> | null = null
  private synth: Tone.PolySynth | null = null
  private bass: Tone.MonoSynth | null = null
  private noise: Tone.NoiseSynth | null = null
  private hit: Tone.MembraneSynth | null = null
  private enabled = true

  async init() {
    if (this.initialized) return
    await Tone.start()
    Tone.Transport.bpm.value = 126
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.08, sustain: 0.2, release: 0.15 },
      volume: -12,
    }).toDestination()
    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'square' },
      filter: { Q: 2, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.25 },
      filterEnvelope: { attack: 0.01, decay: 0.12, sustain: 0.2, baseFrequency: 120, octaves: 2 },
      volume: -8,
    }).toDestination()
    this.noise = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
      volume: -16,
    }).toDestination()
    this.hit = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 1.8,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 },
      volume: -9,
    }).toDestination()

    const lead = ['E4', null, 'G4', 'A4', 'B4', null, 'A4', 'G4', 'E4', null, 'D4', 'E4', 'G4', null, 'B4', 'A4']
    this.sequence = new Tone.Sequence(
      (time, note) => {
        if (!this.enabled || !note || !this.synth) return
        this.synth.triggerAttackRelease(note, '8n', time)
      },
      lead,
      '8n',
    )

    const bassline = ['E2', 'E2', 'B1', 'E2', 'D2', 'D2', 'A1', 'D2']
    this.bassSequence = new Tone.Sequence(
      (time, note) => {
        if (!this.enabled || !this.bass) return
        this.bass.triggerAttackRelease(note, '8n', time)
      },
      bassline,
      '4n',
    )

    if (this.sequence) this.sequence.loop = true
    if (this.bassSequence) this.bassSequence.loop = true
    this.initialized = true
  }

  async startBattleMusic() {
    await this.init()
    if (this.started) return
    this.sequence?.start(0)
    this.bassSequence?.start(0)
    Tone.Transport.start('+0.05')
    this.started = true
  }

  stopBattleMusic() {
    Tone.Transport.stop()
    this.sequence?.stop()
    this.bassSequence?.stop()
    this.started = false
  }

  setEnabled(next: boolean) {
    this.enabled = next
    if (!next) {
      this.stopBattleMusic()
    }
  }

  async playCursor() {
    await this.init()
    if (!this.enabled || !this.synth) return
    this.synth.triggerAttackRelease('E5', '32n')
  }

  async playConfirm() {
    await this.init()
    if (!this.enabled || !this.synth) return
    this.synth.triggerAttackRelease(['G4', 'B4'], '16n')
  }

  async playHit() {
    await this.init()
    if (!this.enabled) return
    this.hit?.triggerAttackRelease('C2', '16n')
    this.noise?.triggerAttackRelease('16n')
  }

  async playBolt() {
    await this.init()
    if (!this.enabled || !this.synth) return
    this.synth.triggerAttackRelease(['B5', 'F#5'], '8n')
    this.noise?.triggerAttackRelease('8n')
  }

  async playVictory() {
    await this.init()
    if (!this.enabled || !this.synth) return
    this.stopBattleMusic()
    const now = Tone.now()
    const notes = ['E4', 'G4', 'B4', 'E5', 'D5', 'C5', 'B4', 'G4']
    notes.forEach((note, index) => this.synth?.triggerAttackRelease(note, '8n', now + index * 0.12))
  }

  dispose() {
    this.stopBattleMusic()
    this.sequence?.dispose()
    this.bassSequence?.dispose()
    this.synth?.dispose()
    this.bass?.dispose()
    this.noise?.dispose()
    this.hit?.dispose()
  }
}

function bubbleLines(text: string, maxWidth: number) {
  const prepared = prepareWithSegments(text, FONT)
  return layoutWithLines(prepared, maxWidth, 20).lines.map((line) => line.text)
}

function PretextBlock({ text, maxWidth, className, font = FONT, lineHeight = 20 }: { text: string; maxWidth: number; className?: string; font?: string; lineHeight?: number }) {
  const layout = useMemo(() => {
    const prepared = prepareWithSegments(text, font)
    return layoutWithLines(prepared, maxWidth, lineHeight)
  }, [font, lineHeight, maxWidth, text])

  return (
    <div className={className} style={{ width: Math.min(maxWidth, Math.max(...layout.lines.map((line) => line.width), 0) + 18 || maxWidth) }}>
      {layout.lines.map((line, index) => (
        <span key={`${line.text}-${index}`} className="pretext-line">{line.text}</span>
      ))}
    </div>
  )
}

function RoutedBattleStage({ title, narrative, allies, enemies, highlightedTargetId, activeActorId }: { title: string; narrative: string; allies: Combatant[]; enemies: Combatant[]; highlightedTargetId: string | null; activeActorId: string | null }) {
  const fillerWords = useMemo(
    () => ['MIDGAR', 'MAKO', 'AVALANCHE', 'REACTOR', 'SHINRA', 'BUSTER', 'BOLT', 'LIMIT', 'QUEUE', 'SECTOR', 'GUARD', 'ATB', 'STEEL', 'RUSH', 'STATIC', 'SLUMS'],
    [],
  )

  const routedNarrative = useMemo(() => {
    const prepared = prepareWithSegments(narrative, '700 20px "Courier New"')
    const rows: { text: string; x: number; y: number }[] = []
    let cursor = { segmentIndex: 0, graphemeIndex: 0 }
    let y = 34
    while (true) {
      const leftObstacle = y >= 76 && y <= 176
      const rightObstacle = y >= 132 && y <= 236
      const startX = leftObstacle ? 230 : 32
      const maxWidth = 760 - (leftObstacle ? 210 : 0) - (rightObstacle ? 210 : 0)
      const line = layoutNextLine(prepared, cursor, maxWidth)
      if (!line) break
      rows.push({ text: line.text, x: startX, y })
      cursor = line.end
      y += 24
    }
    return rows
  }, [narrative])

  const wordBricks = useMemo(() => {
    const liveEnemies = enemies.filter((enemy) => enemy.alive)
    if (liveEnemies.length > 0) {
      return liveEnemies.flatMap((enemy, enemyIndex) => {
        const base = enemy.name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean)
        const words = [...base, enemy.subtitle, `${enemy.hp}HP`, enemyIndex === 0 ? 'MACHINE' : 'BURST']
        return words.map((word, index) => ({
          id: `${enemy.id}-${word}-${index}`,
          text: word.toUpperCase(),
          enemyId: enemy.id,
          row: enemyIndex,
          index,
        }))
      })
    }
    return fillerWords.map((word, index) => ({ id: `${word}-${index}`, text: word, enemyId: null, row: Math.floor(index / 4), index }))
  }, [enemies, fillerWords])

  return (
    <div className="breaker-stage">
      <div className="breaker-screen">
        <div className="breaker-topbar">
          <div>
            <div className="breaker-title">PRETEXT BATTLE // FF7 FIRST STRIKE</div>
            <div className="breaker-subtitle">Break the enemy language, hold the line, survive the reactor sweep.</div>
          </div>
          <div className="breaker-hud">
            <span>SCORE {aliveScore(enemies)}</span>
            <span>LIVES {allies.filter((ally) => ally.alive).length}</span>
            <span>LEVEL 1</span>
          </div>
        </div>

        <div className="breaker-playfield">
          <div className="breaker-noise" />
          <div className="breaker-routed-copy">
            {routedNarrative.map((line, index) => (
              <span key={`${line.text}-${index}`} className="breaker-copy-line" style={{ left: line.x, top: line.y }}>{line.text}</span>
            ))}
          </div>

          <div className="breaker-words">
            {wordBricks.map((brick) => (
              <div
                key={brick.id}
                className={`word-brick ${brick.enemyId && highlightedTargetId === brick.enemyId ? 'is-target' : ''} ${brick.enemyId ? '' : 'is-filler'}`}
                style={{
                  left: 96 + brick.index * 118 + brick.row * 18,
                  top: 112 + brick.row * 58 + (brick.index % 2) * 6,
                }}
              >
                {brick.text}
              </div>
            ))}
          </div>

          <div className={`fighter-chip cloud-chip ${activeActorId === 'cloud' ? 'is-active' : ''}`}>CLOUD // {allies[0]?.hp ?? 0}HP</div>
          <div className={`fighter-chip barret-chip ${activeActorId === 'barret' ? 'is-active' : ''}`}>BARRET // {allies[1]?.hp ?? 0}HP</div>
          {enemies.map((enemy, index) => (
            <div key={enemy.id} className={`fighter-chip enemy-chip enemy-chip-${index} ${highlightedTargetId === enemy.id ? 'is-target' : ''} ${!enemy.alive ? 'is-down' : ''}`}>
              {enemy.name.toUpperCase()} // {enemy.alive ? `${enemy.hp}HP` : 'DOWN'}
            </div>
          ))}

          <div className="breaker-callout">
            <span className="breaker-callout-title">{title.toUpperCase()}</span>
            <span>Press Start, then route commands through text.</span>
          </div>

          <div className="breaker-footer">
            <span>MOVE: mouse / arrows</span>
            <span>CONFIRM: enter / click</span>
            <span>BACK: esc</span>
            <span>TEXT IS THE PLAYFIELD</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function aliveScore(enemies: Combatant[]) {
  return enemies.filter((enemy) => !enemy.alive).length * 800 + enemies.reduce((sum, enemy) => sum + (enemy.maxHp - enemy.hp), 0)
}

function App() {
  const [phase, setPhase] = useState<BattlePhase>('intro')
  const [party, setParty] = useState<Combatant[]>(createInitialParty())
  const [enemies, setEnemies] = useState<Combatant[]>(createInitialEnemies())
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_ITEMS)
  const [activeActorId, setActiveActorId] = useState<string | null>(null)
  const [menuLayer, setMenuLayer] = useState<MenuLayer>('root')
  const [rootIndex, setRootIndex] = useState(0)
  const [magicIndex, setMagicIndex] = useState(0)
  const [itemIndex, setItemIndex] = useState(0)
  const [targetIndex, setTargetIndex] = useState(0)
  const [pendingChoice, setPendingChoice] = useState<QueuedAction | null>(null)
  const [battleLog, setBattleLog] = useState<string[]>([
    'The reactor trembles. Cloud and Barret leap into battle.',
  ])
  const [bannerText, setBannerText] = useState('Those Who Fight?')
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [victoryStats] = useState({ exp: 32, ap: 10, gil: 48 })

  const partyRef = useRef(party)
  const enemiesRef = useRef(enemies)
  const phaseRef = useRef(phase)
  const activeActorRef = useRef(activeActorId)
  const processingRef = useRef(isProcessing)
  const audioRef = useRef<AudioDirector | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const visualRef = useRef<VisualState>({
    flashUntil: 0,
    shakeUntil: 0,
    lungeActorId: null,
    lungeUntil: 0,
    castActorId: null,
    castUntil: 0,
    currentBanner: 'Those Who Fight?',
    bannerUntil: 0,
    popups: [],
  })
  const popupCounter = useRef(0)

  useEffect(() => {
    audioRef.current = new AudioDirector()
    return () => audioRef.current?.dispose()
  }, [])

  useEffect(() => {
    partyRef.current = party
  }, [party])
  useEffect(() => {
    enemiesRef.current = enemies
  }, [enemies])
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    activeActorRef.current = activeActorId
  }, [activeActorId])
  useEffect(() => {
    processingRef.current = isProcessing
  }, [isProcessing])
  useEffect(() => {
    audioRef.current?.setEnabled(audioEnabled)
    if (audioEnabled && phase === 'battle') {
      void audioRef.current?.startBattleMusic()
    }
  }, [audioEnabled, phase])

  const aliveEnemies = enemies.filter((enemy) => enemy.alive)
  const aliveAllies = party.filter((ally) => ally.alive)
  const activeActor = party.find((ally) => ally.id === activeActorId) ?? null
  const targetableEnemies = aliveEnemies
  const targetPool = pendingChoice?.kind === 'item' ? aliveAllies : targetableEnemies
  const currentTarget = targetPool[targetIndex] ?? targetPool[0] ?? null

  const rootMenu = useMemo(() => {
    if (!activeActor) return []
    return [
      { id: 'attack', label: 'Attack' },
      { id: 'magic', label: activeActor.spellbook.length > 0 ? 'Magic' : 'Magic — No Materia' },
      { id: 'item', label: 'Item' },
      { id: 'defend', label: 'Defend' },
    ]
  }, [activeActor])

  const selectedSpell = activeActor?.spellbook[magicIndex] ?? null
  const selectedItem = inventory[itemIndex] ?? null
  const logText = battleLog[0] ?? ''
  const logLines = useMemo(() => bubbleLines(logText, LOG_WRAP_WIDTH), [logText])
  const bannerLines = useMemo(() => bubbleLines(bannerText, 300), [bannerText])

  const pushLog = useCallback((text: string) => {
    setBattleLog((prev) => [text, ...prev].slice(0, 6))
  }, [])

  const showBanner = useCallback((text: string, duration = 950) => {
    visualRef.current.currentBanner = text
    visualRef.current.bannerUntil = performance.now() + duration
    setBannerText(text)
  }, [])

  const addPopup = useCallback((x: number, y: number, value: string, hue: string) => {
    popupCounter.current += 1
    visualRef.current.popups.push({
      id: `popup-${popupCounter.current}`,
      x,
      y,
      value,
      hue,
      createdAt: performance.now(),
    })
  }, [])

  const resetBattle = useCallback(async () => {
    setPhase('battle')
    setParty(createInitialParty())
    setEnemies(createInitialEnemies())
    setInventory(INITIAL_ITEMS)
    setActiveActorId(null)
    setMenuLayer('root')
    setRootIndex(0)
    setMagicIndex(0)
    setItemIndex(0)
    setTargetIndex(0)
    setPendingChoice(null)
    setBattleLog(['The reactor trembles. Cloud and Barret leap into battle.'])
    setBannerText('Those Who Fight?')
    visualRef.current = {
      flashUntil: 0,
      shakeUntil: 0,
      lungeActorId: null,
      lungeUntil: 0,
      castActorId: null,
      castUntil: 0,
      currentBanner: 'Those Who Fight?',
      bannerUntil: performance.now() + 1600,
      popups: [],
    }
    await audioRef.current?.startBattleMusic()
  }, [])

  const introBattle = useCallback(async () => {
    setPhase('battle')
    showBanner('Fight!', 1200)
    pushLog('Shinra security closes in — act before they raise the alarm.')
    await audioRef.current?.startBattleMusic()
  }, [pushLog, showBanner])

  const setCombatants = useCallback((nextParty: Combatant[], nextEnemies: Combatant[]) => {
    setParty(nextParty)
    setEnemies(nextEnemies)
    partyRef.current = nextParty
    enemiesRef.current = nextEnemies
  }, [])

  const actorById = useCallback((id: string) => {
    return [...partyRef.current, ...enemiesRef.current].find((actor) => actor.id === id) ?? null
  }, [])

  const enemyActionFor = useCallback(async (enemyId: string) => {
    const livingAllies = partyRef.current.filter((ally) => ally.alive)
    if (livingAllies.length === 0) return
    const target = livingAllies[Math.floor(Math.random() * livingAllies.length)]
    await processAction({ actorId: enemyId, targetId: target.id, kind: 'attack' })
  }, [])

  const finishBattleIfNeeded = useCallback(async (nextParty: Combatant[], nextEnemies: Combatant[]) => {
    if (nextEnemies.every((enemy) => !enemy.alive)) {
      setPhase('victory')
      showBanner('Victory Fanfare', 1600)
      pushLog('The reactor guard falls. Avalanche presses deeper into the core.')
      await audioRef.current?.playVictory()
      return true
    }
    if (nextParty.every((ally) => !ally.alive)) {
      setPhase('defeat')
      showBanner('Mission Failed', 1600)
      pushLog('Cloud and Barret collapse as the reactor alarms continue to howl.')
      audioRef.current?.stopBattleMusic()
      return true
    }
    return false
  }, [pushLog, showBanner])

  const processAction = useCallback(async (action: QueuedAction) => {
    const actor = actorById(action.actorId)
    if (!actor || !actor.alive) return

    setIsProcessing(true)
    processingRef.current = true

    let nextParty = structuredClone(partyRef.current)
    let nextEnemies = structuredClone(enemiesRef.current)

    const resolveActor = (id: string) => {
      return [...nextParty, ...nextEnemies].find((entry) => entry.id === id)
    }

    const acting = resolveActor(action.actorId)
    const target = action.targetId ? resolveActor(action.targetId) : null
    if (!acting) {
      setIsProcessing(false)
      processingRef.current = false
      return
    }

    acting.atb = 0
    acting.defending = false

    if (action.kind === 'attack') {
      const label = acting.type === 'enemy' ? 'Machine Gun' : acting.name === 'Barret' ? 'Big Shot Burst' : 'Buster Slash'
      showBanner(label)
      visualRef.current.lungeActorId = acting.id
      visualRef.current.lungeUntil = performance.now() + 350
      await audioRef.current?.playConfirm()
      await sleep(240)
      if (target && target.alive) {
        let damage = Math.max(7, Math.round(acting.attack * 0.9 + Math.random() * 10 - target.defense * 0.45))
        if (acting.id === 'barret') damage += 4
        if (target.defending) damage = Math.floor(damage * 0.55)
        target.hp = clamp(target.hp - damage, 0, target.maxHp)
        target.alive = target.hp > 0
        target.defending = false
        visualRef.current.flashUntil = performance.now() + 110
        visualRef.current.shakeUntil = performance.now() + 120
        const x = target.type === 'enemy' ? 705 : 235
        const y = target.type === 'enemy' ? 210 : 270
        addPopup(x, y, `${damage}`, acting.type === 'enemy' ? '#f1c27d' : '#ffb347')
        pushLog(`${acting.name} strikes ${target.name} for ${damage} damage.`)
        await audioRef.current?.playHit()
        if (!target.alive) {
          pushLog(`${target.name} is defeated.`)
          showBanner(`${target.name} Down`, 700)
        }
      }
    }

    if (action.kind === 'magic') {
      const spell = action.spellId ? SPELLS[action.spellId] : null
      if (spell && target && target.alive && acting.mp >= spell.cost) {
        acting.mp -= spell.cost
        showBanner(spell.name)
        visualRef.current.castActorId = acting.id
        visualRef.current.castUntil = performance.now() + 450
        await audioRef.current?.playBolt()
        await sleep(280)
        let damage = Math.max(16, Math.round(spell.power + acting.magic * 0.8 + Math.random() * 16 - target.defense * 0.15))
        target.hp = clamp(target.hp - damage, 0, target.maxHp)
        target.alive = target.hp > 0
        const x = target.type === 'enemy' ? 705 : 235
        const y = target.type === 'enemy' ? 190 : 250
        addPopup(x, y, `${damage}`, '#8ad7ff')
        visualRef.current.flashUntil = performance.now() + 240
        pushLog(`${acting.name} casts ${spell.name}. ${target.name} takes ${damage} lightning damage.`)
        if (!target.alive) {
          pushLog(`${target.name} collapses in a burst of blue static.`)
        }
      } else {
        pushLog(`${acting.name} cannot cast right now.`)
      }
    }

    if (action.kind === 'item') {
      const item = inventory.find((entry) => entry.id === action.itemId)
      const allyTarget = target && target.type === 'ally' ? target : resolveActor('cloud')
      if (item && item.amount > 0 && allyTarget && allyTarget.alive) {
        const missingHp = allyTarget.maxHp - allyTarget.hp
        if (missingHp <= 0) {
          pushLog(`${allyTarget.name} is already at full HP.`)
        } else {
          setInventory((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, amount: entry.amount - 1 } : entry))
          const healAmount = Math.min(item.heal, missingHp)
          allyTarget.hp = clamp(allyTarget.hp + item.heal, 0, allyTarget.maxHp)
          addPopup(allyTarget.id === 'cloud' ? 245 : 305, allyTarget.id === 'cloud' ? 220 : 320, `+${healAmount}`, '#98f5b5')
          showBanner(item.name)
          pushLog(`${acting.name} uses ${item.name} on ${allyTarget.name}. ${healAmount} HP restored.`)
          await audioRef.current?.playConfirm()
        }
      } else {
        pushLog('No item effect could be applied.')
      }
    }

    if (action.kind === 'defend') {
      acting.defending = true
      showBanner('Defend', 700)
      pushLog(`${acting.name} braces for impact and cuts incoming damage.`)
      await audioRef.current?.playConfirm()
    }

    setCombatants(nextParty, nextEnemies)
    const battleFinished = await finishBattleIfNeeded(nextParty, nextEnemies)
    setIsProcessing(false)
    processingRef.current = false
    if (!battleFinished && activeActorRef.current === action.actorId) {
      setActiveActorId(null)
      activeActorRef.current = null
    }
  }, [actorById, addPopup, finishBattleIfNeeded, inventory, pushLog, setCombatants, showBanner])

  useEffect(() => {
    if (phase !== 'battle') return
    const interval = window.setInterval(() => {
      if (processingRef.current || activeActorRef.current) return
      const nextParty = structuredClone(partyRef.current)
      const nextEnemies = structuredClone(enemiesRef.current)
      let changed = false
      const all = [...nextParty, ...nextEnemies]
      all.forEach((actor) => {
        if (!actor.alive || actor.atb >= 100) return
        actor.atb = clamp(actor.atb + actor.speed, 0, 100)
        changed = true
      })
      if (changed) {
        setCombatants(nextParty, nextEnemies)
      }

      const readyAlly = nextParty.find((ally) => ally.alive && ally.atb >= 100)
      if (readyAlly) {
        setActiveActorId(readyAlly.id)
        activeActorRef.current = readyAlly.id
        setMenuLayer('root')
        setRootIndex(0)
        setMagicIndex(0)
        setItemIndex(0)
        setTargetIndex(0)
        showBanner(`${readyAlly.name} Ready`, 700)
        return
      }

      const readyEnemy = nextEnemies.find((enemy) => enemy.alive && enemy.atb >= 100)
      if (readyEnemy) {
        void enemyActionFor(readyEnemy.id)
      }
    }, 90)
    return () => window.clearInterval(interval)
  }, [enemyActionFor, phase, setCombatants, showBanner])

  const navigateMenu = useCallback(async (direction: 1 | -1) => {
    await audioRef.current?.playCursor()
    if (menuLayer === 'root') {
      setRootIndex((prev) => (prev + direction + rootMenu.length) % rootMenu.length)
    }
    if (menuLayer === 'magic' && activeActor) {
      const count = Math.max(1, activeActor.spellbook.length)
      setMagicIndex((prev) => (prev + direction + count) % count)
    }
    if (menuLayer === 'item') {
      const count = Math.max(1, inventory.length)
      setItemIndex((prev) => (prev + direction + count) % count)
    }
    if (menuLayer === 'target') {
      const count = Math.max(1, targetPool.length)
      setTargetIndex((prev) => (prev + direction + count) % count)
    }
  }, [activeActor, menuLayer, rootMenu.length, targetPool.length])

  const confirmSelection = useCallback(async () => {
    if (!activeActor) return
    await audioRef.current?.playConfirm()

    if (menuLayer === 'root') {
      const selected = rootMenu[rootIndex]?.id
      if (selected === 'attack') {
        setPendingChoice({ actorId: activeActor.id, kind: 'attack' })
        setMenuLayer('target')
        return
      }
      if (selected === 'magic') {
        if (activeActor.spellbook.length === 0) {
          pushLog(`${activeActor.name} has no equipped Materia.`)
          return
        }
        setMenuLayer('magic')
        return
      }
      if (selected === 'item') {
        setMenuLayer('item')
        return
      }
      if (selected === 'defend') {
        setActiveActorId(null)
        activeActorRef.current = null
        await processAction({ actorId: activeActor.id, kind: 'defend' })
      }
      return
    }

    if (menuLayer === 'magic' && selectedSpell) {
      setPendingChoice({ actorId: activeActor.id, kind: 'magic', spellId: selectedSpell.id })
      setMenuLayer('target')
      return
    }

    if (menuLayer === 'item' && selectedItem) {
      if (selectedItem.amount <= 0) {
        pushLog(`${selectedItem.name} is out of stock.`)
        return
      }
      setPendingChoice({ actorId: activeActor.id, kind: 'item', itemId: selectedItem.id })
      setTargetIndex(0)
      setMenuLayer('target')
      return
    }

    if (menuLayer === 'target' && currentTarget) {
      const choice = pendingChoice ?? { actorId: activeActor.id, kind: 'attack' as ActionKind }
      setPendingChoice(null)
      setMenuLayer('root')
      setActiveActorId(null)
      activeActorRef.current = null
      await processAction({ ...choice, targetId: currentTarget.id })
      setTargetIndex(0)
    }
  }, [activeActor, currentTarget, menuLayer, pendingChoice, processAction, pushLog, rootIndex, rootMenu, selectedItem, selectedSpell])

  const cancelSelection = useCallback(async () => {
    await audioRef.current?.playCursor()
    if (menuLayer === 'target') {
      setMenuLayer(pendingChoice?.kind === 'magic' ? 'magic' : pendingChoice?.kind === 'item' ? 'item' : 'root')
      return
    }
    if (menuLayer === 'magic' || menuLayer === 'item') {
      setMenuLayer('root')
    }
  }, [menuLayer, pendingChoice])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (phase === 'intro' && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        void introBattle()
        return
      }
      if ((phase === 'victory' || phase === 'defeat') && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        void resetBattle()
        return
      }
      if (phase !== 'battle' || !activeActor) return
      if (event.key === 'ArrowDown' || event.key === 's') {
        event.preventDefault()
        void navigateMenu(1)
      }
      if (event.key === 'ArrowUp' || event.key === 'w') {
        event.preventDefault()
        void navigateMenu(-1)
      }
      if (event.key === 'ArrowLeft' || event.key === 'a') {
        if (menuLayer === 'target') {
          event.preventDefault()
          void navigateMenu(-1)
        }
      }
      if (event.key === 'ArrowRight' || event.key === 'd') {
        if (menuLayer === 'target') {
          event.preventDefault()
          void navigateMenu(1)
        }
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        void confirmSelection()
      }
      if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault()
        void cancelSelection()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeActor, cancelSelection, confirmSelection, introBattle, menuLayer, navigateMenu, phase, resetBattle])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawBackground = (time: number) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
      gradient.addColorStop(0, '#121313')
      gradient.addColorStop(0.4, '#1d2220')
      gradient.addColorStop(1, '#3a322b')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const lower = ctx.createLinearGradient(0, 230, 0, canvas.height)
      lower.addColorStop(0, '#4c4b46')
      lower.addColorStop(1, '#1f211f')
      ctx.fillStyle = lower
      ctx.fillRect(0, 230, canvas.width, 230)

      ctx.strokeStyle = 'rgba(238, 225, 201, 0.14)'
      ctx.lineWidth = 2
      for (let i = 0; i < 14; i += 1) {
        const y = 248 + i * 20
        ctx.beginPath()
        ctx.moveTo(40, y)
        ctx.lineTo(920, y - 30)
        ctx.stroke()
      }

      ctx.fillStyle = 'rgba(242, 229, 212, 0.1)'
      ctx.fillRect(50, 120, 120, 95)
      ctx.fillRect(770, 92, 140, 110)
      ctx.fillRect(605, 48, 90, 70)
      ctx.fillStyle = '#d16f3e'
      ctx.fillRect(705, 78, 16, 58)
      ctx.fillRect(205, 100, 14, 68)
      ctx.fillStyle = 'rgba(236, 185, 127, 0.36)'
      ctx.fillRect(710, 62, 6, 18)
      ctx.fillRect(210, 84, 6, 18)
      const pulse = 0.2 + Math.sin(time / 260) * 0.04
      ctx.fillStyle = `rgba(244, 191, 134, ${pulse})`
      ctx.fillRect(464, 64, 32, 120)
    }

    const entityPosition = (id: string) => {
      switch (id) {
        case 'cloud': return { x: 248, y: 292 }
        case 'barret': return { x: 160, y: 348 }
        case 'mp-a': return { x: 730, y: 248 }
        case 'mp-b': return { x: 810, y: 324 }
        default: return { x: 100, y: 100 }
      }
    }

    const drawCloud = (x: number, y: number) => {
      ctx.fillStyle = '#f7d7b5'
      ctx.fillRect(x - 12, y - 64, 24, 26)
      ctx.fillStyle = '#f1d69f'
      ctx.beginPath()
      ctx.moveTo(x - 18, y - 52)
      ctx.lineTo(x - 6, y - 78)
      ctx.lineTo(x + 4, y - 52)
      ctx.lineTo(x + 24, y - 76)
      ctx.lineTo(x + 16, y - 44)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#36343f'
      ctx.fillRect(x - 20, y - 38, 40, 44)
      ctx.fillStyle = '#6c5ca2'
      ctx.fillRect(x - 24, y - 36, 8, 32)
      ctx.fillStyle = '#33261c'
      ctx.fillRect(x - 36, y - 16, 68, 9)
      ctx.fillRect(x + 24, y - 20, 10, 32)
      ctx.fillStyle = '#222'
      ctx.fillRect(x - 14, y + 6, 10, 34)
      ctx.fillRect(x + 4, y + 6, 10, 34)
      ctx.fillStyle = '#2a2a2a'
      ctx.fillRect(x - 46, y - 10, 14, 16)
    }

    const drawBarret = (x: number, y: number) => {
      ctx.fillStyle = '#784d34'
      ctx.fillRect(x - 12, y - 82, 26, 18)
      ctx.fillStyle = '#f0c8a0'
      ctx.fillRect(x - 14, y - 64, 28, 24)
      ctx.fillStyle = '#36453b'
      ctx.fillRect(x - 24, y - 40, 48, 52)
      ctx.fillStyle = '#4d3626'
      ctx.fillRect(x - 34, y - 26, 16, 20)
      ctx.fillStyle = '#7a7e83'
      ctx.fillRect(x + 20, y - 28, 36, 20)
      ctx.fillStyle = '#202020'
      ctx.fillRect(x - 18, y + 12, 12, 36)
      ctx.fillRect(x + 6, y + 12, 12, 36)
    }

    const drawTrooper = (x: number, y: number, hue: string) => {
      ctx.fillStyle = '#c2bfc7'
      ctx.fillRect(x - 12, y - 62, 24, 24)
      ctx.fillStyle = hue
      ctx.fillRect(x - 18, y - 38, 36, 54)
      ctx.fillStyle = '#17213c'
      ctx.fillRect(x - 36, y - 24, 18, 12)
      ctx.fillRect(x + 18, y - 24, 28, 12)
      ctx.fillStyle = '#1c2230'
      ctx.fillRect(x - 16, y + 16, 12, 34)
      ctx.fillRect(x + 4, y + 16, 12, 34)
    }

    let frame = 0
    let stopped = false

    const render = (time: number) => {
      if (stopped) return
      ctx.save()
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const fx = visualRef.current
      const shakeOffset = time < fx.shakeUntil ? Math.sin(time / 15) * 6 : 0
      ctx.translate(shakeOffset, 0)
      drawBackground(time)

      const everyone = [...partyRef.current, ...enemiesRef.current]
      everyone.forEach((actor) => {
        if (!actor.alive) return
        const pos = entityPosition(actor.id)
        let { x, y } = pos
        if (time < fx.lungeUntil && fx.lungeActorId === actor.id) {
          x += actor.type === 'ally' ? 40 : -40
        }
        if (time < fx.castUntil && fx.castActorId === actor.id) {
          y += Math.sin(time / 30) * 3
        }
        if (actor.id === 'cloud') drawCloud(x, y)
        if (actor.id === 'barret') drawBarret(x, y)
        if (actor.id === 'mp-a') drawTrooper(x, y, '#394f7d')
        if (actor.id === 'mp-b') drawTrooper(x, y, '#2f415e')
        if (actor.defending) {
          ctx.strokeStyle = 'rgba(240, 210, 150, 0.9)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(x, y - 10, 40, 0, Math.PI * 2)
          ctx.stroke()
        }
      })

      const now = performance.now()
      if (now < fx.flashUntil) {
        ctx.fillStyle = 'rgba(145, 208, 255, 0.28)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      fx.popups = fx.popups.filter((popup) => now - popup.createdAt < 900)
      fx.popups.forEach((popup) => {
        const age = now - popup.createdAt
        ctx.globalAlpha = 1 - age / 900
        ctx.fillStyle = popup.hue
        ctx.font = '700 30px Georgia'
        ctx.fillText(popup.value, popup.x, popup.y - age * 0.06)
        ctx.globalAlpha = 1
      })

      ctx.restore()
      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div className="app-shell">
      <div className="ambient-grid" />
      <div className="title-strip">
        <div>
          <p className="eyebrow">Interactive battle remake</p>
          <h1>Final Fantasy VII — First Battle</h1>
          <p className="subtitle">A playable browser encounter rebuilt as a text-native pretext-style arcade battle, with original recreated audio.</p>
        </div>
        <div className="control-cluster">
          <button className="mute-toggle" onClick={() => setAudioEnabled((prev) => !prev)}>
            {audioEnabled ? 'Audio: On' : 'Audio: Off'}
          </button>
          <button className="mute-toggle ghost" onClick={() => window.open('https://github.com/errusch/ff7-first-battle', '_blank')}>
            GitHub Repo
          </button>
        </div>
      </div>

      <div className="battle-layout">
        <section className="battle-stage-card">
          <div className="battle-stage-frame">
            <div className="sr-only-stage-canvas"><canvas ref={canvasRef} width={960} height={540} /></div>
            <RoutedBattleStage
              title={bannerText}
              narrative={battleLog[0] ?? 'The reactor hums with unstable mako while commands and threats crowd the room.'}
              allies={party}
              enemies={enemies}
              highlightedTargetId={menuLayer === 'target' ? currentTarget?.id ?? null : null}
              activeActorId={activeActorId}
            />
            <div className="battle-banner">
              {bannerLines.map((line, index) => (
                <span key={`${line}-${index}`}>{line}</span>
              ))}
            </div>

            {phase === 'intro' && (
              <div className="overlay-panel intro-panel">
                <p className="eyebrow">Mako Reactor No. 1</p>
                <h2>Bombing Mission</h2>
                <p>The classic opening battle reimagined as a warm editorial tactics screen. Press start and survive the reactor security sweep.</p>
                <button className="start-button" onClick={() => void introBattle()}>Start Battle</button>
              </div>
            )}

            {(phase === 'victory' || phase === 'defeat') && (
              <div className="overlay-panel outcome-panel">
                <p className="eyebrow">{phase === 'victory' ? 'Encounter cleared' : 'Party wiped'}</p>
                <h2>{phase === 'victory' ? 'Mission Complete' : 'Try Again'}</h2>
                {phase === 'victory' ? (
                  <div className="reward-grid">
                    <div><span>EXP</span><strong>{victoryStats.exp}</strong></div>
                    <div><span>AP</span><strong>{victoryStats.ap}</strong></div>
                    <div><span>Gil</span><strong>{victoryStats.gil}</strong></div>
                  </div>
                ) : (
                  <p>The Shinra MPs force the team back. Reload the scene and hit harder on the opening turn.</p>
                )}
                <button className="start-button" onClick={() => void resetBattle()}>{phase === 'victory' ? 'Replay Battle' : 'Restart Fight'}</button>
              </div>
            )}
          </div>
        </section>

        <section className="sidebar-column terminal-column">
          <div className="terminal-module">
            <div className="terminal-title">ALLY_FEED</div>
            {party.map((ally) => (
              <div key={ally.id} className={`terminal-line ${activeActorId === ally.id ? 'is-hot' : ''} ${!ally.alive ? 'is-dim' : ''}`}>
                <span>{ally.name.toUpperCase()}</span>
                <span>HP {ally.hp}/{ally.maxHp}</span>
                <span>MP {ally.mp}/{ally.maxMp}</span>
                <span>{!ally.alive ? 'KO' : ally.defending ? 'DEFEND' : ally.atb >= 100 ? 'READY' : 'CHARGE'}</span>
              </div>
            ))}
          </div>

          <div className="terminal-module">
            <div className="terminal-title">HOSTILES</div>
            {enemies.map((enemy, index) => (
              <button
                key={enemy.id}
                className={`terminal-line terminal-button ${currentTarget?.id === enemy.id && menuLayer === 'target' ? 'is-hot' : ''} ${!enemy.alive ? 'is-dim' : ''}`}
                onClick={() => {
                  if (menuLayer === 'target' && enemy.alive) {
                    setTargetIndex(index)
                    void confirmSelection()
                  }
                }}
              >
                <span>{enemy.name.toUpperCase()}</span>
                <span>{enemy.subtitle.toUpperCase()}</span>
                <span>{enemy.alive ? `${enemy.hp}HP` : 'DOWN'}</span>
              </button>
            ))}
          </div>

          <div className="terminal-module">
            <div className="terminal-title">COMMAND_BUFFER // {activeActor ? activeActor.name.toUpperCase() : 'WAIT'}</div>
            {phase === 'battle' && activeActor ? (
              <>
                {menuLayer === 'root' && rootMenu.map((option, index) => (
                  <button key={option.id} className={`terminal-line terminal-button ${rootIndex === index ? 'is-hot' : ''}`} onClick={() => { setRootIndex(index); void confirmSelection() }}>
                    <span>{option.label.toUpperCase()}</span>
                  </button>
                ))}
                {menuLayer === 'magic' && activeActor.spellbook.map((spell, index) => (
                  <button key={spell.id} className={`terminal-line terminal-button ${magicIndex === index ? 'is-hot' : ''}`} onClick={() => { setMagicIndex(index); void confirmSelection() }}>
                    <span>{spell.name.toUpperCase()}</span>
                    <span>{spell.cost} MP</span>
                  </button>
                ))}
                {menuLayer === 'item' && inventory.map((item, index) => (
                  <button key={item.id} disabled={item.amount <= 0} className={`terminal-line terminal-button ${itemIndex === index ? 'is-hot' : ''}`} onClick={() => { setItemIndex(index); void confirmSelection() }}>
                    <span>{item.name.toUpperCase()}</span>
                    <span>x{item.amount}</span>
                  </button>
                ))}
                {menuLayer === 'target' && targetPool.map((combatant, index) => (
                  <button key={combatant.id} className={`terminal-line terminal-button ${targetIndex === index ? 'is-hot' : ''}`} onClick={() => { setTargetIndex(index); void confirmSelection() }}>
                    <span>{combatant.name.toUpperCase()}</span>
                    <span>{combatant.hp}HP</span>
                  </button>
                ))}
                <div className="terminal-hint">↑↓ NAV // ENTER CONFIRM // ESC BACK</div>
              </>
            ) : (
              <div className="terminal-hint">ATB CHARGES IN REAL TIME. COMMAND INPUT PAUSES ON READY.</div>
            )}
          </div>

          <div className="terminal-module">
            <div className="terminal-title">FIELD_NOTES</div>
            <div className="terminal-log-major">{logLines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</div>
            <div className="terminal-log-minor">
              {battleLog.slice(1, 4).map((entry, index) => (
                <div key={`${entry}-${index}`} className="terminal-line is-minor">{entry.toUpperCase()}</div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default App
