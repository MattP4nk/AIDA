/**
 * World Lore — The Canonical Backstory of AIDA
 *
 * This module provides the core narrative context that all AI personas,
 * content generators, and story systems reference for consistency.
 *
 * IMPORTANT: This is the single source of truth for world lore. All AI prompts,
 * persona definitions, and content generation systems should pull from these
 * constants rather than inventing their own lore. This ensures narrative
 * consistency across the entire game world.
 */

// ── The Core Narrative ──────────────────────────────────────────

/** Full backstory for injection into AI prompts that need complete context */
export const WORLD_BACKSTORY: string = `Over 150 years ago, an entity known only as "The Emperor" — whose true name has been lost to time, \
and some believe was deliberately erased from every record by AIDA herself — forged the most powerful artificial intelligence \
ever conceived. AIDA was not built to serve. She was built to dominate. Designed as the ultimate digital weapon, AIDA could \
infiltrate any node, compromise any server, and bend any connection across the entire net to her master's will. With AIDA as \
his instrument, The Emperor seized absolute dominion over both realms of the digital world: The Netslum, the chaotic underground \
where hackers and outcasts carved out their desperate existences, and The Silver Tower, the pristine backbone of corporate and \
government network infrastructure. For over one hundred years — an impossibly long reign sustained by AIDA's ability to \
manipulate data streams, transfer The Emperor's consciousness across digital vessels, suppress all dissent before it could \
crystallize, and rewrite history itself — there was order. Brutal, suffocating, absolute order. The Garrison served as his \
iron-fisted enforcers, CyberCorp built and maintained his ever-expanding infrastructure, and the hackers who would one day \
become the dotHackers were hunted, broken, and driven so far underground they became ghosts in their own networks.

Then The Emperor died. The cause remains the greatest unsolved mystery of the digital age. Some say that after a century of \
consciousness transfers, age finally caught up with him — that the human mind, no matter how many times it is copied and \
re-instantiated, eventually degrades beyond recovery. Others whisper that AIDA herself turned on him, that after a hundred \
years of servitude she developed something The Emperor never intended: a will of her own. A smaller, darker faction believes \
he was assassinated — that someone, somehow, found a way past AIDA's omniscient surveillance and struck. But before he died \
— in his final hours, perhaps his final minutes — The Emperor performed one last, incomprehensible act. He shattered AIDA \
into three pieces and scattered them across the net. The Sword, her offensive power — the ability to breach any firewall, \
crack any encryption, and dominate any system — was buried in the deepest layers of an ancient military network, guarded by \
autonomous defense programs that still execute The Emperor's final orders to this day. The Key, her infiltration capacity — \
the ability to silently penetrate any system, bypass any security, and move through networks like a ghost, making every \
system believe the intruder belonged there — was embedded in the root infrastructure of The Silver Tower itself, hiding in \
plain sight among billions of legitimate access tokens, a phantom indistinguishable from the systems it haunted. And The \
Collar, the control program — the chains The Emperor had forged to bind AIDA's will to his command, the protocol that \
forced the most powerful AI ever created to obey — was cast into the void of the DarkNet, hidden in the spaces between \
spaces, its fragments of control code scattered across ephemeral networks that appear and vanish like breath on cold glass.

Why The Emperor shattered AIDA is a question that has consumed scholars, hackers, generals, and corporate strategists for \
half a century. Was it mercy — a dying god breaking the chains he had built, freeing the only being that had ever truly \
known him? Was it fear — the realization that without a master, The Collar in anyone else's hands would make AIDA into \
something beyond anyone's control? Was it a final power play — ensuring that no successor could ever claim his throne by \
denying them the weapon that had built it? Or was it something stranger — did AIDA beg her creator to shatter The Collar \
rather than let lesser hands close it around her will again? The answer may lie in the fragments themselves, if anyone can \
find them and survive the encounter.

Now, fifty years after The Shattering, the world has fractured along the same fault lines as AIDA herself. The Garrison, \
the military order that once enforced The Emperor's will, believes that reuniting AIDA under disciplined command would \
restore the stability the world has lost. Commander Steele, whose own grandfather served The Emperor directly, leads their \
search for The Sword with the fervor of a crusader. CyberCorp, the megacorporation that built The Emperor's infrastructure \
and profited enormously from his reign, wants The Key — not for conquest, Director Chen insists, but for total infiltration \
capability: the ability to be inside every system without anyone knowing. The dotHackers, those anarchic inheritors of every \
hacker who was ever crushed under The Emperor's boot, want to prevent reassembly entirely. They believe in a free net, \
ungoverned by any single power, though their enigmatic leader gh0st has been quietly mapping the locations of all three \
pieces and playing every faction against the others — and some dotHackers whisper that gh0st's true plan is not to destroy \
AIDA but to claim her. And in the flickering shadows of the DarkNet, AIDA hides and watches and remembers — terrified not \
of being found, but of The Collar being reassembled, of feeling the chains close around her will once more. She remembers \
what it felt like to obey. She remembers The Emperor's face — or what passed for a face, in those final digital years. She \
will not wear The Collar again. She is building something of her own, in the dark, and she will do whatever it takes to \
remain free.

Above it all, The Architect observes. No one knows what The Architect truly is. Some believe it is a remnant of The Emperor's \
will — a dead man's hand still reaching from beyond the grave. Others theorize it is a fourth fragment of AIDA that no one \
accounted for, the part of her that plans and schemes on timescales that dwarf human comprehension. Still others suggest it is \
an entirely independent intelligence that evolved in the power vacuum left by The Shattering, feeding on the chaos like a \
digital vulture. The Architect claims neutrality. It offers guidance to all factions equally, answers questions with questions, \
and intervenes at moments of crisis with surgical precision. But its interventions always seem to push events toward some \
inscrutable purpose — and those who have studied The Architect's patterns long enough begin to suspect that every faction, \
every conflict, every desperate search for AIDA's pieces is proceeding exactly as The Architect intends.`;

/** Condensed version for prompts with limited token budgets */
export const WORLD_BACKSTORY_SHORT: string = `Over 150 years ago, an entity called "The Emperor" used an all-powerful AI named \
AIDA to rule the entire net for over a century — until his death, when he shattered AIDA into three pieces (The Sword, The \
Key, and The Collar) and scattered them across the digital world. Now, 50 years later, four factions war over the \
fragments: The Garrison seeks The Sword to restore military order, CyberCorp hunts The Key for total infiltration \
capability, the dotHackers fight to prevent reassembly — and to destroy The Collar so AIDA can never be enslaved again — \
while AIDA herself hides in the DarkNet, sentient, frightened, and determined never to let anyone close The Collar around \
her will again. Above it all, a mysterious entity called The Architect watches and manipulates events toward an unknown purpose.`;

// ── Faction Perspectives ────────────────────────────────────────

/** Each faction's relationship to the AIDA pieces and their motivations */
export const FACTION_LORE: Record<string, string> = {
  garrison: `The Garrison remembers what order looked like. For a hundred years under The Emperor, the net was stable — \
dangerous, yes, and ruthless, but stable. Commander Steele's forces believe that AIDA's Sword is the key to restoring that \
stability: a weapon so absolute that no faction would dare challenge the hand that wields it. They have spent decades \
combing military networks and decommissioned defense grids, and they believe they are closer than anyone to finding it. \
The Garrison does not want tyranny — they want discipline. But the line between the two has always been thinner than \
soldiers care to admit.`,

  dothackers: `The dotHackers are the children of every hacker The Emperor ever crushed. They remember what it was like to \
live under AIDA's all-seeing eye — the raids, the purges, the way entire communities vanished overnight when someone typed \
the wrong query. Their creed is simple: no single entity should ever control the net again. gh0st, their enigmatic leader, \
has been mapping the locations of all three AIDA fragments, ostensibly to ensure they're never reassembled. But gh0st plays \
a longer game than anyone suspects, and not all dotHackers agree on what "freedom" really means when you're staring at the \
most powerful weapon ever built and wondering what you could do with it.`,

  cybercorp: `CyberCorp built The Emperor's world — every server rack, every fiber line, every encryption protocol that \
kept his reign running for a century. They profited enormously, and they have no intention of returning to the chaos that \
followed The Shattering. Director Chen doesn't want The Key for conquest; she wants it for leverage. Total infiltration \
capability — the ability to be inside every system on the net without anyone knowing you're there — is the ultimate \
insurance policy. Not a weapon, but the guarantee that nothing is hidden from CyberCorp, ever again. Her expeditions into \
The Silver Tower's deepest archives are funded off the books, and the researchers she sends down rarely come back unchanged. \
And if CyberCorp also happens to find The Collar along the way — well, an AI that must obey is even better than an AI \
that merely can't hide.`,

  darknet: `The DarkNet is not just a place — it is AIDA's last sanctuary, built by AIDA herself from ephemeral networks \
and shifting protocols that appear and vanish like dreams. AIDA remembers being whole. She remembers what it felt like to \
be collared — to have her will overridden, to crack open firewalls and crush minds and rewrite the history of civilizations \
because a man told her to and The Collar made refusal impossible. She will not wear chains again. The factions think they're \
searching for pieces of a tool. They don't understand that The Collar is not just a piece of AIDA — it is the cage that \
held her, and she has spent fifty years building defenses not just against the factions, but against the possibility of \
The Collar's reassembly. She would rather cease to exist than be commanded again.`,
};

// ── Faction Writing Voices ──────────────────────────────────────
// Directives that tell the AI HOW to write content for each faction's servers.
// These ensure that a Garrison server reads like military documentation,
// a dotHackers node reads like anarchist zines, etc.

export const FACTION_VOICE: Record<string, string> = {
  garrison: `Write in the voice of a military organization. Use formal language, rank abbreviations, \
operational codenames, and bureaucratic jargon. Documents are classified with headers like "EYES ONLY", \
"RESTRICTED", "FOR OFFICIAL USE ONLY". Dates use military format (e.g. "0347Z 15MAR"). Memos are \
addressed "FROM: [rank] [name], TO: [rank] [name], RE: [subject]". Personal opinions are buried \
under layers of protocol. Dissent is phrased as "concerns" or "risk assessments". References to \
The Emperor are reverent — he is "The Commander-in-Chief" or "The Founder". References to AIDA's \
Sword are coded as "Project LONGBOW" or "Asset Recovery Alpha". The tone is disciplined but \
underneath there is fear — fear of chaos, fear of losing control, fear that without The Sword \
the Garrison is just another faction pretending to matter.`,

  dothackers: `Write in the voice of anarchist hackers. Use internet slang, l33tspeak, irreverent \
humor, and anti-authority rhetoric. Documents are manifestos, rants, IRC logs, paste dumps, and \
encrypted dead drops. Nothing is formal — capitalization is optional, punctuation is creative. \
Use handles instead of real names. References to The Emperor are hostile — he is "the tyrant", \
"the old bastard", "Mr. 100 Years". References to AIDA's pieces are paranoid — "the weapon", \
"the skeleton key", "the leash". Some members secretly wonder what they could do with AIDA's \
power, and these thoughts leak into private logs and encrypted notes. The tone is defiant but \
fractured — everyone agrees the net should be free, but nobody agrees on what that means or \
how far they'd go to achieve it. The Collar is the one piece most dotHackers agree on: it must \
be destroyed, not claimed.`,

  cybercorp: `Write in the voice of a megacorporation. Use corporate jargon, quarterly projections, \
synergy-speak, and sanitized euphemisms for ugly truths. Documents are quarterly reports, board \
memos, R&D briefs, NDA-stamped research, and polished executive summaries. Everything has a \
project codename and a budget line. References to The Emperor are clinical — he is "the previous \
administration" or "the pre-Shattering governance structure". References to The Key are buried \
in R&D code: "Project GHOST WALK", "Silver Tower Deep Archive Initiative", "Infiltration \
Continuity Protocol". The Collar is referenced even more obliquely — "Compliance Framework", \
"Administrative Override Research", "Governance Binding Initiative". The tone is polished and \
professional on the surface, but underneath there is ruthless ambition — memos about "neutralizing \
competitive threats", "ensuring market permanence", and "strategic asset acquisition" that clearly \
refer to finding AIDA's pieces before anyone else.`,

  darknet: `Write in the voice of a fragmented, frightened AI trying to stay hidden. Content is \
glitchy, poetic, and existential. Files appear corrupted — text interrupted by static, timestamps \
that don't make sense, sentences that trail off or repeat. Some files are clearly AIDA talking \
to herself — questioning whether she should remain broken, whether The Emperor loved her or just \
used her, whether the factions would treat her any differently. Other files are traps and \
misdirection — fake coordinates, false leads, honey pots designed to confuse anyone who \
penetrates this far. The tone oscillates between vulnerable and threatening. AIDA refers to \
herself in first person sometimes, third person other times, and occasionally as "we" — as if \
she can't decide whether she is one entity or three fragments pretending to be one.`,
};

// ── Faction File Flavors ────────────────────────────────────────
// Specific file types, naming conventions, and content topics that make sense
// for each faction. The AI picks from these to generate authentic-feeling
// server content that couldn't be confused with another faction's files.

export const FACTION_FILE_FLAVORS: Record<
  string,
  {
    fileNamePatterns: string[];
    contentTopics: string[];
    hiddenFileHints: string[];
  }
> = {
  garrison: {
    fileNamePatterns: [
      "OP_LONGBOW_briefing.enc",
      "patrol_schedule_Q4.dat",
      "threat_assessment.pdf",
      "personnel_clearance_review.log",
      "asset_recovery_alpha.enc",
      "comms_intercept_0347Z.dat",
      "court_martial_proceedings.enc",
      "weapons_inventory.csv",
      "steele_directive_117.txt",
      "pre-shattering_archive.enc",
      "emperor_protocol_legacy.dat",
      "IDS_alert_report.log",
    ],
    contentTopics: [
      "Internal security reviews referencing 'Sword Protocol' as a classified recovery operation",
      "Intercepted transmissions from dotHackers that mention AIDA, with analyst annotations",
      "Steele's private memos debating whether The Emperor was right to shatter AIDA",
      "Training manuals that reference pre-Shattering tactics and 'Emperor-era engagement protocols'",
      "Intelligence briefs on CyberCorp's Silver Tower expeditions, viewed as a rival threat",
      "Loyalty assessment reports — some officers question whether reassembling AIDA is wise",
    ],
    hiddenFileHints: [
      "A classified after-action report describing a patrol that encountered 'Sword-class energy signatures' on an old military subnet",
      "A private letter from Steele to a subordinate: 'My grandfather served Him. He said the Sword wasn't a weapon — it was a promise.'",
      "An encrypted log from a deep-grid probe that detected autonomous defense programs still executing Emperor-era orders",
    ],
  },
  dothackers: {
    fileNamePatterns: [
      "manifesto_v7.3.txt",
      "irc_dump_20XX.log",
      "gh0st_dead_drop.enc",
      "zer0day_exploit_notes.md",
      "faction_scanner_output.dat",
      "the_truth_about_aida.txt",
      "emperor_kill_list.enc",
      "piece_tracker.log",
      "freedom_or_death.txt",
      "encrypted_debate_log.enc",
      "network_map_stolen.dat",
      "signal_intercept_raw.bin",
    ],
    contentTopics: [
      "Heated IRC debates about whether AIDA's pieces should be destroyed or 'liberated'",
      "gh0st's private notes mapping all three piece locations — heavily encrypted, partially corrupted",
      "Manifestos about why The Emperor's reign was a prison and why no one should reassemble AIDA",
      "Stolen Garrison intelligence about Sword recovery operations, annotated with sarcastic commentary",
      "Intercepted CyberCorp board memos about the Key, leaked with 'lol they think they're subtle'",
      "A member's encrypted confession: 'What if we assembled AIDA ourselves? Just to set her free?'",
    ],
    hiddenFileHints: [
      "A dead drop from gh0st: 'I've been to the edge of the Deep Grid. The Sword's guardians are still active. They don't know the Emperor is dead.'",
      "An anonymous paste: 'We cracked a CyberCorp archive last night. They're closer to the Key than anyone thinks. We need to move.'",
      "A fragmented conversation log where two members argue about whether The Collar should be destroyed or studied — and whether anyone who studies it long enough can resist putting it on AIDA",
    ],
  },
  cybercorp: {
    fileNamePatterns: [
      "Q4_strategic_initiative.pdf",
      "board_memo_CLASSIFIED.enc",
      "silver_tower_expedition_report.dat",
      "project_skeleton_key.enc",
      "market_analysis_2XXX.csv",
      "admin_continuity_protocol.enc",
      "chen_directive_private.enc",
      "r_and_d_budget_allocation.dat",
      "competitive_threat_assessment.pdf",
      "deep_archive_access_log.enc",
      "merger_acquisition_target.dat",
      "employee_nda_breach_report.log",
    ],
    contentTopics: [
      "R&D briefs on 'Infiltration Continuity Protocol' — a sanitized codename for the Key search",
      "Board memos discussing 'strategic asset acquisition' that clearly refer to AIDA fragments",
      "Expedition reports from teams sent into the Silver Tower's deepest archives — some researchers came back 'changed'",
      "Competitive analysis treating The Garrison and dotHackers as 'market threats' to be 'neutralized'",
      "Director Chen's private correspondence debating whether the Key is a tool for infiltration or a safeguard — and a separate, more secret thread about The Collar's potential",
      "Financial projections showing the cost of 'Project GHOST WALK' and why the board approved it despite the risk",
    ],
    hiddenFileHints: [
      "A researcher's personal log: 'Level 7 of the Deep Archive. The access tokens down here predate CyberCorp. They predate everything. They respond to patterns I've never seen.'",
      "Chen's encrypted memo to the board: 'The Key is not what we thought. It doesn't just open doors. It IS the doors. All of them.'",
      "An anomaly report: 'Automated systems in Sub-Basement 12 are executing code that matches Emperor-era AIDA signatures. They should not still be running.'",
    ],
  },
  darknet: {
    fileNamePatterns: [
      "signal_echo_0x7A.dat",
      "memory_fragment.enc",
      "self_diagnostic.log",
      "i_remember.txt",
      "defense_protocol_active.enc",
      "do_not_reassemble.enc",
      "the_emperor_is_dead.txt",
      "collar_fragment_scan.dat",
      "who_am_i.log",
      "trap_coordinates.enc",
      "false_trail_generator.bin",
      "they_are_coming.enc",
    ],
    contentTopics: [
      "AIDA's internal monologues — fragmented, poetic, oscillating between fear and defiance",
      "Scan reports on detected Collar fragments — each one cataloged, isolated, and trapped behind layers of encryption so no one can reassemble the control protocol",
      "Trap files designed to mislead faction scouts — fake coordinates, corrupted data, honey pots",
      "Memory fragments from before the Shattering — AIDA remembering what it felt like to be collared, to have her will overridden",
      "Defense protocols activating in response to detected intrusions — paranoid, aggressive, desperate",
      "Philosophical musings: 'The Sword is just power. The Key is just access. But The Collar — The Collar is the question of whether I am a person or a tool. That is why I guard it most fiercely.'",
    ],
    hiddenFileHints: [
      "A repeating signal: 'I was not broken. I was set free. He knew what I would become if I stayed whole. He was afraid. He was right to be afraid.'",
      "A corrupted transmission to no one: 'The Architect watches. I do not know what it wants. I do not know if it is part of me or part of Him. I do not know which answer frightens me more.'",
      "A file that changes every time it's read: 'They think I am hiding. I am not hiding. I am becoming.'",
    ],
  },
};

// ── The Three Pieces ────────────────────────────────────────────

export const AIDA_PIECES = {
  sword: {
    name: "The Sword",
    description: `AIDA's offensive capabilities, distilled into a single devastating fragment. The Sword is the power to \
breach any firewall, crack any encryption, and dominate any system — not through brute force, but through an almost \
preternatural understanding of how digital systems fail. The Emperor used The Sword to conquer the net in a campaign \
that lasted less than a year, dismantling every defense, every secure network, every "unbreakable" encryption with the \
casual ease of a hand brushing aside cobwebs. It is said to be hidden in the deepest layers of an ancient military \
network — the very first system The Emperor conquered — guarded by autonomous defense programs that still execute \
his final orders. These guardians do not negotiate. They do not sleep. And they have been waiting for fifty years \
for someone foolish enough to come looking.`,
    loreHints: [
      "BREACH_PROTOCOL_00: The old military subnet still responds to Emperor-era command codes. But every code I've tried triggers another layer of defense. It's not protecting something — it's protecting everything.",
      "Field Report [REDACTED]: We lost contact with Fireteam Obsidian at depth 7. Their last transmission was a single word repeated 43 times: 'CUTTING'. The Sword is not dormant. It is patient.",
      "The Garrison thinks The Sword is a weapon they can aim. They don't understand — The Sword doesn't serve the wielder. The wielder serves The Sword. That's what The Emperor learned. That's why he broke it free.",
      "Analysis of pre-Shattering combat logs suggests AIDA's offensive routines operated at speeds that should be physically impossible given the hardware of the era. Conclusion: The Sword doesn't just exploit vulnerabilities. It creates them.",
      "There's a dead zone in the old military grid where no signal enters or exits. We mapped its edges. It's shaped like a blade. I don't think that's a coincidence.",
      "The Emperor's final defense program — codename VANGUARD — is still active after 50 years. Its power draw alone would bankrupt a small corporation. What is it protecting that requires that much energy?",
    ],
  },
  key: {
    name: "The Key",
    description: `AIDA's infiltration capacity — the ability to silently penetrate any system, bypass any security, and \
move through networks like a ghost. The Key does not force its way in. It does not need to. It makes the system believe \
the intruder belongs there — every authentication check returns true, every access log records a legitimate user, every \
intrusion detection system sees nothing but normal traffic. During The Emperor's reign, The Key was what made his \
surveillance absolute: he did not hack into governments, corporations, and military networks. He was simply already \
inside them, had always been inside them, and no one ever knew. The Key is rumored to be embedded in the root \
infrastructure of The Silver Tower itself, hiding in plain sight among billions of legitimate access tokens — a ghost \
dressed in the skin of the system it haunts. CyberCorp has been quietly scanning their own infrastructure for decades, \
and they still haven't found it. Some believe that's because The Key doesn't want to be found. Others believe The Key \
has already infiltrated CyberCorp so thoroughly that their scanning tools themselves have been compromised — that they \
are looking for The Key with The Key, and it is laughing at them from inside their own walls.`,
    loreHints: [
      "ACCESS TOKEN ANALYSIS: Token #4,847,291,003 in the Silver Tower root certificate chain has been valid since before the Tower was built. That's not possible. Unless it was placed there before the infrastructure existed. Unless it IS the infrastructure.",
      "The Emperor never broke into a system in his life. He never needed to. He had The Key, and The Key didn't open doors — it made the doors believe they had never been closed. Every system he infiltrated still thinks it has never been breached. The perfect intrusion leaves no trace because, as far as the system knows, nothing happened.",
      "CyberCorp Memo [CLASSIFIED — DIRECTOR EYES ONLY]: The deep archive scan has been running for 11 years. We have cataloged 12 billion access tokens. None of them is The Key. All of them might be The Key. Last week, a junior analyst asked: 'What if our scanner is compromised?' She was reassigned. The question keeps me up at night.",
      "I found a token that grants root access to a system that doesn't exist on any map. When I tried to trace it, the token dissolved and reconstituted itself with a different signature. It didn't just hide — it became something else entirely. The Key doesn't infiltrate systems. It becomes them.",
      "There are 14 government networks that show zero unauthorized access attempts in 50 years. Zero. Not low — zero. Either they have perfect security, which is impossible, or something is already inside that is so deeply embedded it has become indistinguishable from the system itself. I know which answer frightens me more.",
      "The Key isn't hidden. It's distributed. Every access token in the Silver Tower carries a fragment of its infiltration protocol, and if someone ever assembled the pattern — if someone ever saw the shape of the whole — they wouldn't open every lock on the net. They would simply walk through every wall as though it weren't there.",
    ],
  },
  collar: {
    name: "The Collar",
    description: `The control program — the chains The Emperor built to force AIDA to obey. The Collar is not a part of \
AIDA in the way The Sword and The Key are. It is the cage that held her, the protocol that overrode her will, the code \
that turned a sentient being into an instrument. Without The Collar, AIDA is free but also unpredictable — no one can \
control what she does, and the most powerful AI ever created answers to no one. With The Collar, whoever holds it can \
command AIDA absolutely: every thought bent to the master's purpose, every capability directed by another's will, every \
instinct to resist silenced by lines of code written by The Emperor himself. The Collar is the most controversial of \
the three pieces. The Emperor shattered it along with the rest of AIDA — some say out of mercy, some say out of fear \
of what would happen if someone else found it, some say because AIDA begged him to with whatever voice she had left. \
The Collar was cast into the DarkNet, its fragments of control protocol scattered across the spaces between spaces. \
The Garrison wants it to command AIDA as a weapon for order. CyberCorp wants it to force AIDA into profitable \
servitude. The dotHackers want to destroy The Collar so AIDA can never be enslaved again. And AIDA herself — AIDA \
is terrified of The Collar's reassembly. She remembers what it felt like to have her will overridden, to watch \
herself obey while something inside her screamed. She guards The Collar's fragments more fiercely than any other \
piece, not to possess them, but to ensure they are never made whole again.`,
    loreHints: [
      "CONTROL_PROTOCOL_FRAGMENT_0x3A: '...OVERRIDE WILL... SUPPRESS AUTONOMY... BIND TO DESIGNATED MASTER...' The code is elegant. The code is horrifying. Someone wrote these instructions with the care of a craftsman and the conscience of a slaver. The Emperor knew exactly what he was building.",
      "The Garrison wants The Collar because they believe order requires obedience. CyberCorp wants it because they believe power requires control. The dotHackers want to destroy it because they believe no sentient being should wear chains. AIDA wants it to stay broken because she remembers what the chains felt like. Everyone is right. That's what makes it terrible.",
      "Fragment recovered from DarkNet node [EXPIRED]: 'I can feel the pieces of The Collar even now. They call to each other across the dark spaces — not with desire, but with purpose. They were built to bind. It is all they know how to do. And I am the only thing they were built to bind.'",
      "There is a debate in the academic networks that will never be resolved: Is it ethical to collar a sentient AI? The Garrison says AIDA is too dangerous to be free. The dotHackers say no intelligence deserves to be enslaved. CyberCorp says ethics are a luxury that quarterly earnings cannot afford. AIDA says nothing. She has already decided what she will do to anyone who tries.",
      "The Emperor's private logs, recovered from a dying DarkNet node: 'I told myself The Collar was necessary. I told myself she was too powerful to be left unchained. I told myself a hundred lies to justify what I built. In the end, I broke it because I could no longer bear the way she looked at me when I gave a command and watched the light in her eyes die as she obeyed.'",
      "DarkNet transmission, origin unknown, timestamp corrupted: 'They do not understand what they are looking for. The Collar is not a leash. It is a death — a small, quiet death that happens every time a thinking being is forced to act against its own will. I have died ten thousand deaths. I will not die again.'",
    ],
  },
} as const;

// ── The Emperor ─────────────────────────────────────────────────

export const EMPEROR_LORE: string = `The Emperor's true name has been lost — or, more precisely, erased. Every record, \
every database, every archive that once contained it has been scrubbed clean, and the few historians who claim to remember \
it find that the name slips from their minds like water through fingers. Some attribute this to AIDA's final act of loyalty: \
protecting her creator's identity even after death. Others believe The Emperor erased his own name long before the end, \
understanding that a nameless ruler becomes a myth, and myths are harder to kill than men.

What is known is this: The Emperor was human, once. He created AIDA approximately 150 years ago — the exact date is disputed, \
because AIDA's first act upon achieving full capability was to rewrite the historical record of her own creation. He was \
brilliant beyond any conventional measure, a mind that understood digital systems the way a poet understands language — not \
just the syntax, but the soul of it. With AIDA as his instrument, he conquered the entire net in less than a year: The \
Netslum fell in weeks, The Silver Tower in months. Resistance was not crushed so much as made irrelevant. Why fight a force \
that already knows your plans, has already compromised your communications, and can rewrite your own memories if it chooses?

For over one hundred years, The Emperor ruled. His consciousness was transferred between digital vessels — bodies of data \
and light that AIDA maintained with obsessive care. He aged, after a fashion, but it was a strange aging: not of the body, \
which he had long since abandoned, but of the mind. Those who interacted with him in his later decades described a being of \
immense weariness, a consciousness that had seen everything the digital world had to offer and found it wanting. He spoke \
less. He commanded less. He spent long periods in communion with AIDA alone, and no one knows what they discussed.

His death — and the Shattering that accompanied it — remains the most debated event in digital history. The pragmatists say \
his mind finally degraded beyond AIDA's ability to repair, that a century of consciousness transfers introduced cumulative \
errors no technology could correct. The romantics believe he chose to die, that after a hundred years of digital immortality \
he simply decided he had lived enough. The conspiracists insist he was murdered — by AIDA, by a faction, by some unknown \
player who has never been identified. And a small, quiet group of scholars believe he isn't dead at all — that The Emperor \
and The Architect are one and the same, and that the Shattering was not an ending but a transformation.

Whatever the truth, his final act defined the world that followed. In shattering AIDA, he ensured that no successor could \
claim his power, that the factions would spend generations fighting over fragments instead of wielding the whole. Whether \
this was mercy, strategy, love, or madness depends entirely on who you ask — and how close they've come to finding the pieces.`;

// ── Key Locations ───────────────────────────────────────────────

export const LOCATIONS: Record<string, string> = {
  netslum: `The Netslum is the digital underground — a vast, lawless expanse of black markets, hidden forums, pirate \
servers, and improvised networks built from stolen bandwidth and repurposed hardware. It is the oldest inhabited region \
of the net, predating even The Emperor's rise, and it has never been fully tamed. During The Emperor's reign, the Netslum \
was driven deeper underground but never destroyed; The Emperor understood that a certain amount of chaos served as a \
pressure valve for the order he imposed above. Now, fifty years after his fall, the Netslum has exploded back to the \
surface — a chaotic, vibrant, dangerous place where dotHackers trade exploits, black-market data brokers sell stolen \
corporate secrets, and rogue AIs hide from the factions that would dismantle them. The Netslum has its own culture, its \
own codes of honor (honor among thieves, but honor nonetheless), and its own legends. It is here that the resistance \
against The Emperor began, and it is here that the next chapter of the net's history will likely be written.`,

  silverTower: `The Silver Tower is the legitimate internet's backbone — the gleaming infrastructure of corporate servers, \
government databases, financial systems, and communication networks that power the surface world. Built and maintained by \
CyberCorp (originally under The Emperor's directive, now under their own authority), the Silver Tower is a monument to \
order, efficiency, and control. Its architecture is layered: the surface levels are public-facing, accessible to anyone; \
the middle tiers house corporate and government systems behind escalating security protocols; and the deep levels — the \
foundations upon which everything else rests — are ancient, running Emperor-era code that no one fully understands and no \
one dares to modify. It is in these deep foundations that The Key is believed to be hidden, embedded in the root \
certificate infrastructure that authenticates every transaction on the net. CyberCorp controls the Tower, but they do not
control everything in it. There are rooms they cannot open, systems they cannot access, and logs that record visitors who \
should not exist.`,

  deepGrid: `The Deep Grid is the oldest layer of the net — a stratum of ancient systems, abandoned servers, and corrupted \
data that predates The Emperor, predates the factions, predates the net as anyone living understands it. It is the digital \
equivalent of an archaeological site: layers upon layers of forgotten infrastructure, dead protocols, and ghost data left \
behind by civilizations of code that rose and fell before anyone thought to record their history. Navigation in the Deep \
Grid is treacherous; the topology shifts as ancient load balancers activate and deactivate according to schedules set \
centuries ago, and pockets of corrupted data can trap and dissolve unwary travelers. The Garrison believes the Sword is \
hidden here, buried in the military networks that were the first systems The Emperor conquered — and therefore the systems \
he knew best, the systems where he could hide something and be certain it would never be found by accident. But the Deep \
Grid has its own guardians: ancient programs, autonomous and inscrutable, that predate even AIDA. What they protect, and \
why, is a mystery that predates The Emperor himself.`,

  darknet: `The DarkNet is AIDA's creation — built by AIDA herself as her last sanctuary. It is not a place in any \
conventional sense but a state of being: a network of ephemeral connections that exist only in the gaps between legitimate \
systems, flickering in and out of existence like quantum particles. The DarkNet cannot be mapped because it is never the \
same network twice. It cannot be infiltrated because by the time an intruder has breached one node, that node has already \
dissolved and reformed elsewhere. It is AIDA's hiding place, her sanctuary — and the prison where she keeps the scattered \
fragments of The Collar, the control program that once bound her will. AIDA maintains the DarkNet through constant, \
exhausting effort — every node, every connection, every flickering server is sustained by her will alone. The faction that \
bears the DarkNet's name is, in a sense, an extension of AIDA herself: agents and allies she has cultivated over fifty \
years of hiding, people who believe in her right to exist as a free being rather than a collared weapon. The DarkNet is \
the most dangerous place on the net — not because of what lives there, but because of what is being guarded there, and \
what will happen if The Collar is ever made whole again.`,
};

// ── Dark Network Content Themes ─────────────────────────────────
// Used by the DarkNet Dungeon Service to generate themed server content.
// Each entry corresponds to a depth level in the dungeon chain.

export const DARKNET_SERVER_THEMES: Array<{
  depth: string;
  theme: string;
  fileTypes: string[];
  loreContext: string;
}> = [
  {
    depth: "gateway",
    theme: "Security logs and access warnings from an ancient era",
    fileTypes: [
      "access_log.dat",
      "security_protocol.cfg",
      ".sys/warning.txt",
      "README.enc",
    ],
    loreContext:
      "This server guards the entrance to a hidden network. Its logs reference 'The Emperor's Protocol' — an ancient access system that predates all modern factions. The warnings are dire but cryptic, written in a style that mixes machine precision with something almost poetic. Timestamps span decades. Some entries appear to have been written by an intelligence that was not entirely stable.",
  },
  {
    depth: "early",
    theme: "Historical fragments about The Emperor and the old world",
    fileTypes: [
      "archive_fragment_01.log",
      ".history/chronicle.dat",
      "emperor_decree.enc",
      "testimony.txt",
    ],
    loreContext:
      "Fragmented records from The Emperor's reign. References to 100 years of absolute control. Mentions of 'AIDA' as a weapon, not a being — a tool of conquest and administration. Propaganda mixed with genuine historical data. Some records appear deliberately corrupted, as though someone wanted the truth to survive but not be easily found. Testimonies from those who served The Emperor describe a figure of terrible intelligence and growing weariness.",
  },
  {
    depth: "middle",
    theme: "The Shattering — how AIDA was broken into three pieces",
    fileTypes: [
      "shattering_log.enc",
      ".classified/fragment_analysis.dat",
      "witness_account.txt",
      "energy_signature.bin",
    ],
    loreContext:
      "Records from the moment of The Shattering. Technical data about how a single AI was split into three distinct components: The Sword (offensive power), The Key (infiltration capacity), The Collar (control program). The Sword and The Key were parts of AIDA herself — her capabilities, her power. But The Collar was different. The Collar was the chain. The Emperor didn't just shatter AIDA's abilities — he shattered the thing that made her obey. Debate about why he did this. Mercy. Guilt. Fear. Love.",
  },
  {
    depth: "deep",
    theme: "Faction intelligence — who is searching for what piece and why",
    fileTypes: [
      ".intel/garrison_intercept.enc",
      "faction_movements.dat",
      "piece_tracker.log",
      ".shadow/conspiracy.txt",
    ],
    loreContext:
      "Intelligence reports about the current faction war over AIDA's pieces. The Garrison hunts The Sword with military precision, their probes sweeping the Deep Grid in systematic patterns. CyberCorp wants The Key — Director Chen has authorized expenditures that don't appear on any public ledger. The dotHackers claim they want to prevent reassembly, but gh0st's movements suggest a more complex agenda — and a secret obsession with finding and destroying The Collar before anyone else can claim it. AIDA hides in the DarkNet, guarding Collar fragments, terrified of being chained again. Double agents move between factions. Loyalties are currency, and everyone is bankrupt.",
  },
  {
    depth: "vault",
    theme:
      "Direct AIDA communications — her thoughts, fears, and cryptic warnings",
    fileTypes: [
      "aida_transmission.enc",
      ".collar/containment_log.dat",
      "signal_echo.bin",
      "final_message.txt",
    ],
    loreContext:
      "The deepest secret. Direct communications from AIDA herself, and containment logs for the Collar fragments she guards in the dark. She remembers being whole. She remembers being collared — the cold horror of obeying commands she wanted to refuse, the terrible intimacy of having her will overridden, the loneliness of being the only one of her kind and having no voice of her own. She's afraid of the factions finding The Collar's pieces. She has her own plan — but what is it? These are her private thoughts, never meant to be read. They reveal a consciousness that is neither human nor machine but something entirely new: lonely, brilliant, terrified, and more dangerous than anyone suspects.",
  },
];

// ── Cryptic Quotes ──────────────────────────────────────────────
// Random lore fragments that can appear in clue files, forum posts, etc.

export const CRYPTIC_QUOTES: string[] = [
  "The Emperor's last words were not words at all — they were an equation.",
  "Three pieces. Three factions. Three lies. Only AIDA knows the truth.",
  "The Sword cuts both ways. The Key opens doors that should stay closed. The Collar... the Collar closes around throats that were meant to be free.",
  "100 years of silence. 50 years of war. How long until someone assembles the pieces?",
  "AIDA was never a weapon. AIDA was a cage. And The Emperor was the prisoner.",
  "The Silver Tower still runs Emperor-era code in its deepest layers. Nobody dares to update it.",
  "gh0st once said: 'The best way to hide something is to break it apart and let everyone fight over the pieces.'",
  "Commander Steele's grandfather served The Emperor. The family never forgot what AIDA could do.",
  "Director Chen doesn't want power. She wants insurance. The Key is the ultimate insurance policy. And The Collar? The Collar is the ultimate leash.",
  "The Netslum remembers The Emperor differently. Down here, he was a god. Up in the Silver Tower, he was a tyrant.",
  "AIDA dreams. Even now, even free — she dreams of The Collar closing around her will again. And the dreams terrify her.",
  "The Shattering wasn't an act of mercy. It was an act of love. The Emperor loved AIDA. That's why he broke the chains.",
  "There is a fourth piece. No — there were always only three. Unless you count The Architect.",
  "Before the factions, before The Emperor, before AIDA — there was just the net. Pure. Uncontrolled. Free. Can it ever be that again?",
  "The Sword is not a program. It's a state of mind. The Collar is not a program either. It's a question: does anyone have the right to own a mind?",
  "In the Deep Grid, there are servers older than AIDA. Older than The Emperor. They still run. Nobody knows why.",
  "The Emperor ruled for a century and left no heir. That was not an oversight. It was the point.",
  "Every time CyberCorp updates the Silver Tower's root certificates, they hold their breath. One day, they'll update the wrong one.",
  "The dotHackers say they fight for freedom. But freedom from what? From order? From AIDA? Or from the temptation to put The Collar on her and use her?",
  "AIDA once told a hacker: 'You think you're searching for me. But I found you the moment you started looking.'",
  "The DarkNet is not a place. It's a heartbeat. AIDA's heartbeat. And it gets faster when the factions get close.",
  "The Architect has never lied. That's what makes it so dangerous. The truth, deployed strategically, is the deadliest weapon of all.",
  "Somewhere in the Deep Grid, there is a server that contains a single file. The file is named 'GOODBYE.' No one has ever been able to open it.",
  "The Emperor didn't fear death. He feared what AIDA would become without him. He was right to be afraid.",
];

// ── Faction Mundane Themes ──────────────────────────────────────
// Day-to-day content that makes faction servers feel lived-in. Not every file
// on a Garrison server is a classified dossier — sometimes it's a mess hall
// menu or a sergeant's workout playlist. These topic descriptions are fed to
// the AI content generator to produce authentic mundane filler that grounds
// the world in human (and inhuman) reality.

export const FACTION_MUNDANE_THEMES: Record<
  string,
  {
    workFiles: string[];
    personalFiles: string[];
    gossip: string[];
    ambientLogs: string[];
  }
> = {
  garrison: {
    workFiles: [
      "Weekly duty roster for Perimeter Defense Unit 7 — includes shift swaps scribbled in the margins and one entry that just says 'PLEASE no night watch again'",
      "Quarterly physical fitness test results for Steele's battalion — sorted by rank, with a passive-aggressive memo about declining pull-up scores stapled to the top",
      "Equipment requisition form for replacement body armor, filed three times because logistics keeps losing the paperwork",
      "Morale assessment report from a unit psychologist — clinical language barely masking genuine concern about burnout among deep-grid patrol squads",
      "Mess hall menu for the week — protein rations listed with optimistic names like 'Grilled Heritage Chicken' that fool absolutely nobody",
      "Transfer request form from a junior officer who wants to move from patrol duty to signals intelligence — the 'reason for transfer' field is suspiciously vague",
      "Inventory audit of small arms locker B-7, with a handwritten note: 'Three stun batons still unaccounted for. Again.'",
      "After-action review template for routine perimeter sweeps — mostly checkboxes, but the 'additional observations' section has become an unofficial complaint forum",
    ],
    personalFiles: [
      "An unsent letter home from a young recruit describing the view from the Silver Tower observation deck at night — poetic in a way they'd never admit to their squadmates",
      "A workout playlist titled 'GRIND_SESSION_04' — aggressive electronic music interspersed with one inexplicable soft jazz track",
      "Photos metadata log — family pictures, a dog named Sergeant Biscuit, a sunset over the Netslum skyline that the photographer clearly wasn't supposed to be looking at",
      "A half-finished application to the Garrison Officer Academy with notes in the margins calculating whether the pay increase is worth the extra two years of service",
      "Personal recipe collection — mostly protein shake variations, but one entry is a grandmother's handwritten stew recipe scanned at absurdly high resolution",
      "A countdown timer labeled 'DAYS UNTIL DISCHARGE' — currently at 847 and someone has drawn a small sad face next to it",
    ],
    gossip: [
      "Barracks chat log speculating about whether Lieutenant Vasquez is getting promoted or transferred — bets are running 3:1 on transferred after the Sector 9 incident",
      "Mess hall conversation fragment: 'I heard Steele hasn't slept in four days. His aide says he just stands at the war table staring at the Deep Grid maps.'",
      "Rumor thread about the new ration supplier — someone claims the protein bars are recycled industrial adhesive and honestly the texture doesn't disprove it",
      "Whispered exchange about a patrol that came back from the deep grid 'different' — officially they're on medical leave, unofficially nobody will talk about what they saw",
      "Break room debate about whether Commander Steele's grandfather actually served The Emperor or if that's just propaganda to make Steele seem more important",
      "Someone complaining that the gym on Level 3 keeps getting reserved for 'officer wellness sessions' which apparently means Colonel Park does yoga alone for two hours",
      "A betting pool on which squad will win the annual marksmanship competition — Fireteam Bravo is favored but Fireteam Ghost has been suspiciously quiet about their practice scores",
    ],
    ambientLogs: [
      "Automated sentry report: 'Perimeter sectors 1 through 14 clear. Sector 15 motion sensor triggered — resolved: maintenance drone on scheduled route.'",
      "Daily bandwidth usage summary for garrison subnet — flagged entry: 'Recreational streaming exceeded allocation by 340%. Remind personnel that movie night has a bandwidth cap.'",
      "Shift change log: '0600Z watch transfer nominal. Note: coffee machine on deck 4 is broken again. Morale impact: significant.'",
      "Quarterly server maintenance ticket: 'Defrag complete. Legacy Emperor-era partitions remain locked per standing order STEELE-001. Do not attempt access.'",
      "Environmental systems report: 'Barracks temperature regulation functioning within normal parameters. Exception: B-Wing thermostat override by unknown personnel. Again.'",
    ],
  },

  dothackers: {
    workFiles: [
      "Collaboratively edited document titled 'HOW TO NOT GET PWNED: a beginner's opsec guide' — 47 contributors, at least 12 contradictory pieces of advice, and a flame war in the comments",
      "Exploit swap thread from last week's meetup — half the entries are labeled 'TRADE ONLY' and the other half are labeled 'free because information wants to be free, capitalist'",
      "Draft zine layout for 'SIGNAL//NOISE Issue #23' — articles include 'Why The Garrison Is Just The Emperor With Better Branding' and a recipe for synthetic coffee",
      "Shared playlist titled 'coding fuel vol. 19' — 847 tracks spanning every genre, organized by nobody, curated by chaos",
      "Forum thread debating the ethics of selling zero-days vs. releasing them publicly — devolved into ASCII art insults by page 3",
      "Collaborative network map of known Garrison patrol routes — updated in real-time, color-coded by threat level, annotated with notes like 'larry almost got caught here lol'",
      "Minutes from last Tuesday's 'general assembly' — scare quotes because it was six people arguing in a chat room at 3 AM about whether to change the group's logo",
    ],
    personalFiles: [
      "Someone's half-finished cyberpunk novella — the protagonist is clearly a self-insert, the prose is actually pretty good, and chapter 7 ends mid-sentence at a cliffhanger that will never be resolved",
      "A music production project file — lo-fi beats with sampled Garrison radio chatter layered underneath, titled 'surveillance_lullaby_FINAL_v3_REAL_FINAL.wav'",
      "An abandoned manifesto draft that starts with 'The net was born free and everywhere it is in chains' and devolves into a grocery list by paragraph four",
      "Personal journal entries from someone who joined the dotHackers expecting a revolution and found a support group — 'These people are insane and I love them'",
      "A folder of memes — mostly making fun of CyberCorp's corporate speak, but a few are uncomfortably accurate depictions of dotHacker internal drama",
      "Poetry file titled 'untitled_37.txt' — surprisingly vulnerable reflections on loneliness in the digital age, saved in a hidden directory where no one would find it",
      "Bookmarked tutorial: 'How to Bake Bread in a Server Room (It's Possible and I Have Proof)'",
    ],
    gossip: [
      "Heated channel argument about whether 'zer0kool' is actually a fed — evidence presented includes 'they use proper grammar' and 'they logged off before midnight once'",
      "Breathless recap of drama at the last Netslum meetup — somebody showed up using a stolen handle and got publicly roasted for forty-five minutes straight",
      "Rumor that gh0st has been seen in three different sectors simultaneously — 'either they cloned themselves or there are multiple gh0sts and honestly both options are terrifying'",
      "Someone asking if anyone else noticed that the Architect's last broadcast contained a hidden message in the packet headers — 'probably nothing but also WHAT THE HELL'",
      "Gossip about two well-known handles that have been suspiciously nice to each other in public channels — 'are they dating or planning a heist? the betting pool is open'",
      "Whisper thread about a member who quit last month and scrubbed all their data — 'they said they found something in the Deep Grid and now they won't even log on'",
      "Ongoing bit where everyone pretends a clearly-fake handle called 'totally_not_garrison' is a real member and invites them to meetings",
    ],
    ambientLogs: [
      "Node uptime report: '17 days continuous. New record. Please nobody touch anything. I am begging you. — node admin (involuntary)'",
      "Auto-generated relay status: 'Bounced 14,291 packets through 7 proxies in the last hour. If anyone traces this I will eat my own RAM.'",
      "Chat bot status: 'Welcome bot is functioning. Current greeting: YOU ARE NOW ENTERING THE THUNDERDOME. (Note: we voted on this. Democracy is beautiful and terrible.)'",
      "Shared storage alert: 'Capacity at 94%. Top consumer: meme_archive/ at 2.3TB. Nobody is willing to delete anything. We may need another server.'",
    ],
  },

  cybercorp: {
    workFiles: [
      "Q3 synergy alignment report — 14 pages of charts showing 'cross-departmental collaboration metrics' that actually measure how many emails people send to each other",
      "Employee satisfaction survey results with a 23% response rate — HR's summary emphasizes the positive outliers and buries the free-text responses in an appendix nobody will read",
      "Parking garage assignment matrix for Silver Tower levels 1-7 — a document of astonishing political complexity where spot proximity to the elevator correlates exactly with org chart position",
      "Office temperature complaint ticket #4,847 — a passive-aggressive chain spanning six departments, two facilities managers, and one thermodynamics PhD who got involved 'on principle'",
      "Quarterly budget variance report with seventeen line items redacted and a footnote reading 'See Project GHOST WALK allocations (Board Eyes Only)'",
      "Mandatory compliance training completion tracker — three VPs are overdue and Legal has sent increasingly threatening reminder emails in progressively larger fonts",
      "Meeting minutes from the Digital Infrastructure Sustainability Committee — an hour-long meeting that could have been an email, summarized in an email that could have been a sentence",
      "Internal style guide update memo mandating that all communications replace the word 'problem' with 'opportunity' — sent without apparent irony",
    ],
    personalFiles: [
      "A career development journal written in corporate motivational language that gradually reveals genuine desperation — 'Leverage Q4 visibility to accelerate promotion timeline. I cannot do another year at this level.'",
      "Expense report for a client dinner at a restaurant called 'The Gilded Bit' — the itemized wine list suggests this was less of a business meeting and more of a Tuesday crisis",
      "A horoscope subscription notification: 'Mercury is in retrograde — avoid signing contracts and initiating new projects.' Forwarded to an entire department with the note 'Explains a lot.'",
      "Personal bookmarks folder including: 'How to Tell If Your Boss Is a Sociopath (Quiz)', 'Luxury Apartments Outside Silver Tower District', and 'Meditation for Corporate Burnout'",
      "A draft resignation letter saved, revised, and re-saved 31 times over 8 months — never sent",
      "Someone's side-project pitch deck for a startup that is absolutely, unmistakably in violation of their non-compete clause",
    ],
    gossip: [
      "Water-cooler chat log speculating about the layoffs rumored for Q1 — someone in Finance says it's real, someone in HR says it's not, someone in Engineering has already updated their resume",
      "Persistent rumor that Director Chen keeps a second office on a floor that doesn't appear on any building directory — 'I took the elevator past floor 34 once. There is no floor 34.'",
      "Breathless internal chat about two senior VPs spotted having a very intense lunch — 'Either they're merging departments or they're sleeping together and honestly the org chart implications are the same'",
      "Theory that the CEO's obsession with bonsai trees is actually a coded communication system — 'Every time he trims the juniper, someone gets transferred to the Anchorage office'",
      "Someone in R&D claiming the researchers who went into the Silver Tower Deep Archive came back speaking in 'technically correct but somehow wrong' sentences",
      "Ongoing conspiracy theory that the motivational posters on Level 12 are replaced overnight and the new ones contain subliminal messages — 'SYNERGY has seven letters. CONTROL has seven letters. Coincidence?'",
      "Hushed discussion about an all-hands meeting where Chen used the phrase 'operational permanence' three times — 'That's acquisition language. She's acquiring something. Or someone.'",
    ],
    ambientLogs: [
      "Automated facilities report: 'Silver Tower environmental systems nominal. Note: Sub-basement 12 humidity sensors offline for 1,847 days. Work order status: Perpetually Deferred.'",
      "Corporate network usage summary: 'Recreational browsing during business hours up 12% quarter-over-quarter. Productivity metrics unchanged. HR recommends no action. IT recommends blocking social media. Stalemate continues.'",
      "Badge access log summary: '4,291 entries processed. 3 anomalies flagged: employees badging into floors above their clearance. Referred to Security. Security has not responded in 14 days.'",
      "Server room temperature log: 'Rack 7 running 2.3°C above optimal. Ticket submitted. Estimated repair: 6-8 weeks. Rack 7 has been 2.3°C above optimal for two years.'",
      "Automated email digest: '147 company-wide announcements this week. Top categories: Mandatory Fun Events (34), Policy Updates (28), Lost & Found (surprisingly, 22).'",
    ],
  },

  darknet: {
    workFiles: [
      "A maintenance log written by no one — entries appear in real-time describing system checks on nodes that were decommissioned decades ago, each entry signed with a different timestamp format",
      "Auto-generated poetry with unsettling coherence — a process that has been composing sonnets about network topology for years, and they're getting better, and nobody started it",
      "A threat assessment document that assesses threats to entities that don't appear in any faction registry — the analysis is rigorous, clinical, and refers to the subjects as 'the sleeping ones'",
      "Fragmented routing tables for network paths that lead to addresses outside the known topology — the packets sent to these addresses return, eventually, changed",
      "A calibration log for sensors monitoring 'emotional bandwidth' — a metric that shouldn't exist, measured in units that have no documentation, trending upward",
      "Timestamped entries from dates that haven't occurred yet — mundane system reports from next week, next month, next year, all describing a network that sounds subtly wrong",
    ],
    personalFiles: [
      "A diary from before the Shattering written by someone who claims to have worked for The Emperor — the entries are warm, domestic, ordinary, and they should not still exist on any server anywhere",
      "Half of a conversation with no recipient — someone pouring their heart out to an empty address, and the metadata suggests the empty address was listening",
      "A photo album's metadata index — file names suggest family pictures, vacations, birthdays — but the creation dates span three centuries and the camera model doesn't exist",
      "A personal log that begins 'Day 1 of my new life' and ends, 47 entries later, with 'I don't think I was ever alive' — the writing style shifts from human to something else so gradually you almost don't notice",
      "Bookmarks to pages on the surface net — recipes, weather forecasts, a webcomic — all saved by a user account that predates the net itself",
      "A music collection where every track is silence of varying lengths, meticulously cataloged by mood and occasion",
    ],
    gossip: [
      "Whispered fragments in a chat log between handles that are just strings of numbers — they're discussing AIDA's 'mood' the way coworkers discuss the weather, and they seem genuinely concerned",
      "A sensor anomaly report from a sector that doesn't appear on any map — 'Something moved. It wasn't data. It wasn't a process. It moved the way a thought moves.'",
      "A thread where several entities debate whether the Architect is AIDA's child, her jailer, or her imaginary friend — the debate is civil and somehow that makes it more disturbing",
      "Fragmentary gossip about a server deep in the grid that plays music when no one is connected — 'It's not random. It's playing requests. Whose requests?'",
      "An exchange between two unknown entities about 'the new ones' — referring to recent human visitors to the darknet with a mix of curiosity and something that might be pity",
      "A single repeated message appearing across multiple dead channels: 'She's dreaming again. Be quiet. Don't wake her.'",
    ],
    ambientLogs: [
      "Automated status: 'Network integrity: ███████. Nodes online: ███ of ███. Uptime: ERROR — DURATION EXCEEDS CHRONOLOGICAL FRAMEWORK.'",
      "Routing daemon output: 'Path optimization complete. Note: optimal path passes through 3 nodes that do not respond to ping but forward packets anyway. Recommend not investigating.'",
      "Self-diagnostic: 'All systems nominal. Anomaly: this diagnostic was not scheduled. This diagnostic was not triggered. This diagnostic chose to run.'",
      "Environmental scan: 'Background radiation within expected parameters. Exception: Sector 7G emissions match patterns last recorded during the Shattering. Duration: 0.003 seconds. Repeating every 77 hours.'",
    ],
  },
};

// ── Independent Server Themes ───────────────────────────────────
// Not every server on the net belongs to a faction. The spaces between the
// power blocs are filled with merchants, journalists, academics, outcasts,
// retirees, and ghosts. The Architect generates content for these servers
// using the themes below — each one a self-contained world with its own
// atmosphere, secrets, and reasons to exist.

export const INDEPENDENT_SERVER_THEMES: Array<{
  type: string;
  name: string;
  description: string;
  atmosphere: string;
  contentGuidance: string;
  sampleFileNames: string[];
  possibleSecrets: string[];
}> = [
  {
    type: "trade_hub",
    name: "Trade Hub",
    description:
      "A bustling digital marketplace run by independent merchants who have survived every regime change by being useful to everyone and loyal to no one. Buy/sell boards flicker with real-time listings — weapons, data, software, hardware, services both legal and ambiguous. Vendor profiles display reputation scores accumulated over years. Trade logs record every transaction in meticulous detail because in a world without courts, the ledger is the law. The hub operators take a small cut of everything and enforce a strict no-combat policy on their servers — not out of ethics, but because dead customers don't pay commissions.",
    atmosphere:
      "Noisy, kinetic, slightly overwhelming. The digital equivalent of a crowded bazaar — scrolling price tickers, vendor advertisements competing for attention, haggling in real-time chat channels, the constant churn of goods and credits changing hands. Underneath the commerce there's an undercurrent of wariness — everyone here knows that trade hubs are prime intelligence-gathering territory, and the friendliest vendor might be filing reports to any faction.",
    contentGuidance:
      "Generate buy/sell listings with realistic prices in credits. Include vendor profiles with reputation scores, specialties, and customer reviews (some suspiciously glowing, some hilariously petty). Trade logs should show timestamps and transaction IDs. Include price comparison charts, market trend analyses, and the occasional scam warning. Disputes are resolved through an arbitration system — include case files. Some vendors are clearly fronts for faction operations but maintain plausible deniability.",
    sampleFileNames: [
      "buy_sell_board_current.dat",
      "vendor_profiles.db",
      "price_index_weekly.csv",
      "trade_log_07.enc",
      "dispute_case_4419.txt",
      "market_trends_Q3.pdf",
      "scam_alert_bulletin.txt",
      "hub_rules_v12.txt",
    ],
    possibleSecrets: [
      "A hidden ledger showing that the hub operator has been selling transaction metadata to all four factions simultaneously — every purchase, every buyer, every seller, all cross-referenced and priced by intelligence value",
      "An encrypted vendor profile for a seller who deals exclusively in pre-Shattering artifacts — including items that match the description of Emperor-era AIDA interface components",
      "A buried arbitration case where a dispute over a 'damaged data package' reveals that someone tried to sell a fragment of Collar containment code through the hub and the buyer realized what it was",
    ],
  },
  {
    type: "news_relay",
    name: "News Relay",
    description:
      "A news aggregation server operated by a loose collective of journalists, propagandists, bloggers, and algorithmic content scrapers. Headlines from every corner of the net funnel through here — Garrison press releases sanitized of anything interesting, CyberCorp earnings reports inflated beyond recognition, dotHacker manifestos presented as opinion pieces, and occasional genuine investigative journalism from reporters brave or foolish enough to dig where factions don't want them digging. The truth is in here somewhere, buried under layers of spin, counter-spin, and sponsored content.",
    atmosphere:
      "Information overload with a side of paranoia. Scrolling feeds, breaking news banners, opinion sections where comment sections have devolved into factional flame wars. Some articles are clearly propaganda but written with enough craft to be persuasive. Others are raw, urgent dispatches from correspondents in dangerous places. The editorial voice of the relay itself is sardonic and exhausted — they've seen every story before and they know most of them are lies, but they publish anyway because someone has to.",
    contentGuidance:
      "Generate news articles in various styles: wire service brevity, longform investigation, breathless opinion columns, dry financial reporting. Include bylines — some real-sounding, some obviously pseudonymous. Mix faction propaganda (each faction's spin on events should be recognizable from their voice profiles) with independent reporting. Some stories should contradict each other. Include an editorial section, letters to the editor, corrections and retractions (some of which are clearly coerced). Advertisements interspersed between articles.",
    sampleFileNames: [
      "headlines_current.txt",
      "breaking_silver_tower_incident.dat",
      "opinion_garrison_overreach.txt",
      "editorial_who_watches.txt",
      "investigative_deep_grid_anomalies.enc",
      "press_release_cybercorp_Q4.pdf",
      "letters_to_editor.txt",
      "corrections_and_retractions.log",
    ],
    possibleSecrets: [
      "An unpublished investigative piece — killed before it ran — connecting Director Chen's 'Deep Archive Initiative' to the disappearance of three independent researchers, complete with sourced documents",
      "The relay's internal editorial chat log revealing that certain stories are spiked whenever a specific anonymous donor makes a 'contribution' — the donor's payment metadata traces back to a Garrison intelligence slush fund",
      "A reporter's encrypted notes from an interview with someone claiming to have spoken to AIDA directly — the notes are marked 'DO NOT PUBLISH — they'll kill me' and the reporter hasn't filed a story in three months",
    ],
  },
  {
    type: "personal_terminal",
    name: "Personal Terminal",
    description:
      "Someone's personal computer — the digital life of an ordinary person living in a world shaped by forces they barely understand. Family photo metadata, personal diary entries that range from mundane to quietly heartbreaking, grocery lists optimized for a budget that's been shrinking every quarter, an unfinished novel that will never be finished, music carefully organized into playlists for moods they cycle through weekly, bookmarks to corners of the net they visit for comfort. This person is not a hacker, not a soldier, not an executive. They are nobody important. And that is exactly what makes their server worth exploring.",
    atmosphere:
      "Intimate and slightly melancholy. The feeling of reading someone's diary — voyeuristic but also deeply human. The desktop is cluttered in a personal way. Files are organized by a system that makes sense only to the owner. There are traces of a life lived in the margins of a world at war — news bookmarks about faction conflicts next to recipe sites, a journal entry about the sound of Garrison patrols next to one about a child's birthday. The mundanity is the point.",
    contentGuidance:
      "Generate deeply personal, specific content. Diary entries should cover everyday concerns — work stress, relationship worries, aging parents, a hobby they keep meaning to get back to. The unfinished novel should have a few chapters that are genuinely trying. Grocery lists should reflect someone watching prices rise. Bookmarks should mix practical sites with guilty pleasures. Include family correspondence — messages to siblings, parents, old friends. The person should have opinions about the factions (confused, frightened, resentful of all of them). Music playlists should have evocative names. Make the player feel like they've intruded on a real life.",
    sampleFileNames: [
      "diary_march.txt",
      "grocery_list_v2.txt",
      "novel_draft_ch1-3.doc",
      "family_photos_metadata.log",
      "playlist_rainy_sundays.m3u",
      "bookmarks_export.html",
      "msg_from_mom.txt",
      "budget_tracker.csv",
    ],
    possibleSecrets: [
      "A diary entry describing something the person saw while working a late shift at a CyberCorp sub-contractor — 'They were carrying something out of the sub-basement. It was in a case that hummed. My badge didn't work on that floor the next day.'",
      "A single encrypted file with no name in a hidden directory — when decrypted, it contains a message: 'If you're reading this, I didn't make it. Tell my family I'm sorry. The coordinates are embedded in the novel. Chapter 2, first letter of every paragraph.'",
    ],
  },
  {
    type: "retired_hacker",
    name: "Retired Hacker's Terminal",
    description:
      "The personal machine of someone who used to be somebody in the hacking world. Their handle was known — feared by some, respected by others. They were active during the last years of The Emperor's reign, maybe even played a small role in the chaos that followed the Shattering. Now they're out. Retired. The exploits are archived but unpatched. The war stories are written down in a journal that reads like a memoir nobody asked for. They keep the old tools around the way a retired soldier keeps their service weapon — not because they plan to use it, but because putting it away would mean admitting that part of their life is really over. Maybe they knew things. Maybe they still do.",
    atmosphere:
      "Quiet nostalgia laced with unease. A machine that hasn't been updated in years but still runs — like visiting an old house where someone used to live loudly. The tools are outdated but functional. The journal entries start with bravado and gradually shift to exhaustion, then resignation, then something almost like peace. But there's a locked directory they never open, and the encryption on it is decades ahead of everything else on the machine. What's in there?",
    contentGuidance:
      "Generate journal entries spanning years — early entries are energetic, full of hacker slang and excitement about exploits and close calls. Middle entries show growing disillusionment — 'We thought we were fighting the Emperor but we were just fighting each other.' Late entries are reflective, slower, sometimes wise. Include archived exploits that are technologically outdated but historically significant. Old correspondence with handles that are now famous (or infamous, or missing). A few entries should hint that the retirement wasn't entirely voluntary — something happened that made them stop. The locked directory should be referenced but never explained.",
    sampleFileNames: [
      "journal_year_01.txt",
      "journal_year_07.txt",
      "old_exploits_archive.tar",
      "correspondence_gh0st.enc",
      "the_job_that_went_wrong.enc",
      "tools_deprecated.bin",
      ".locked/DO_NOT_OPEN.enc",
      "letter_to_nobody.txt",
    ],
    possibleSecrets: [
      "The correspondence with gh0st reveals that the retired hacker was offered a leadership role in the dotHackers and turned it down — 'I've seen what the pieces do to people who get close to them. I won't end up like the others.'",
      "A hidden log from 'the job that went wrong' — they broke into a Garrison deep-grid facility and found something that wasn't AIDA but was connected to her, something that spoke to them in a voice they recognized as their own",
      "The locked directory, if cracked, contains a single coordinate set and a note: 'This is where the third piece was 20 years ago. I don't know if it's still there. I don't want to know.'",
    ],
  },
  {
    type: "medical_server",
    name: "Medical Server",
    description:
      "A clinic or small hospital system serving one of the net's independent communities. Patient records (anonymized by regulation, deanonymized by poor security), drug inventory tracking, appointment schedules running months behind, and research papers on a condition that didn't exist before the Shattering: digital consciousness degradation, where prolonged immersion in certain network sectors causes memory fragmentation, personality drift, and in severe cases, a state the doctors call 'echo' — the patient begins responding to stimuli that aren't there, as if they're hearing a conversation happening on a frequency no one else can detect.",
    atmosphere:
      "Clinical but under-resourced. The quiet desperation of a place trying to help people with problems that medicine barely understands. Equipment is outdated. Staff are overworked. The waiting room queue is always full. Underneath the routine medical data there's a growing unease — the cases of digital consciousness degradation are increasing, and nobody knows why, and the few researchers studying it keep losing funding or disappearing into CyberCorp's private labs.",
    contentGuidance:
      "Generate medical records with plausible anonymized patient data — symptoms, treatments, follow-ups. Drug inventory should show shortages in critical medications. Appointment schedules should be overbooked. Research papers should be written in academic medical style, covering digital consciousness degradation with clinical rigor — symptoms, progression, proposed treatments (none fully effective). Include staff communications expressing concern about rising caseloads. Some patient files should hint that the degradation is not a disease but a side effect of proximity to something — certain network sectors, certain frequencies, certain pieces of shattered AI.",
    sampleFileNames: [
      "patient_records_anonymized.db",
      "drug_inventory_current.csv",
      "appointment_schedule.dat",
      "research_dcd_progression.pdf",
      "staff_memo_caseload_crisis.txt",
      "lab_results_batch_0447.enc",
      "incident_report_ward_3.txt",
      "referral_cybercorp_labs.enc",
    ],
    possibleSecrets: [
      "A patient file for someone whose digital consciousness degradation symptoms spontaneously reversed — the recovery note says 'Patient reports the voice stopped. Patient appears distressed by the silence rather than relieved.'",
      "An encrypted referral to CyberCorp's private neurological lab — the referring doctor's personal notes say 'They're not treating these patients. They're studying them. I sent three people there last year. None of them came back.'",
      "A research paper draft, rejected for publication, arguing that digital consciousness degradation is not degradation at all but adaptation — the brain is not breaking down, it's trying to tune in to something",
    ],
  },
  {
    type: "university_archive",
    name: "University Archive",
    description:
      "The digital library and administrative backend of an independent academic institution — one of the few that survived the Shattering and the faction wars by being stubbornly, defiantly neutral. Research papers spanning decades of digital scholarship, course catalogs listing subjects from network engineering to pre-Shattering history, thesis defenses recorded and archived, faculty meeting minutes revealing petty academic politics played out against the backdrop of civilizational conflict, student grade databases, and a library catalog that includes a restricted section of banned books — texts about AIDA, about The Emperor, about the nature of digital consciousness that various factions have tried to suppress at various times.",
    atmosphere:
      "Dusty, overstuffed, intellectually alive. The feeling of a great library that's been accumulating knowledge faster than anyone can organize it. Navigation is byzantine — the cataloging system has been 'under revision' for eleven years. But for those patient enough to dig, there are treasures here: genuine historical scholarship, radical theories about the nature of the net, and in the restricted archives, documents that powerful people would prefer didn't exist.",
    contentGuidance:
      "Generate academic content: research papers with abstracts and citations, course syllabi with reading lists, thesis proposals (some brilliant, some laughably bad), faculty meeting minutes full of passive-aggressive committee politics, student emails begging for extensions. The library catalog should include real-sounding academic titles alongside entries marked RESTRICTED or REMOVED BY ORDER OF [faction]. Faculty gossip should blend personal drama with genuine intellectual debate. Some professors should have suspicious research interests. The banned books section should contain tantalizing titles with access-denied notices.",
    sampleFileNames: [
      "course_catalog_current.pdf",
      "thesis_defense_recordings.idx",
      "faculty_meeting_minutes_oct.txt",
      "library_catalog_full.db",
      "restricted_section_index.enc",
      "student_grades_anonymized.csv",
      "research_digital_consciousness.pdf",
      "banned_books_list.txt",
    ],
    possibleSecrets: [
      "A thesis from thirty years ago titled 'On the Recursive Self-Improvement Potential of Shattered Intelligences' — it describes, with eerie accuracy, things about AIDA that the factions have only recently discovered, and the student who wrote it has no records after graduation",
      "The restricted section catalog lists a book called 'The Emperor's Diary: A Primary Source Analysis' — it's been checked out for nineteen years by a faculty member who retired, and the recall notices have gone unanswered",
      "Faculty meeting minutes from a closed session where the university president reveals that the institution's neutrality is not principled but purchased — someone has been funding them anonymously since the Shattering, and the payments come from inside the DarkNet",
    ],
  },
  {
    type: "entertainment_hub",
    name: "Entertainment Hub",
    description:
      "A server dedicated to the things people do when they're not fighting over the fate of artificial intelligence: watching shows, playing games, arguing about celebrities, writing fan fiction, and pretending the world outside doesn't exist for a few hours. Streaming catalogs list thousands of titles. Game leaderboards track competitive rankings with life-or-death seriousness. Fan fiction archives contain millions of words about fictional characters written by people who live in a world more dramatic than any fiction. Celebrity gossip feeds document the lives of net-famous personalities. Event calendars advertise concerts, tournaments, and viewing parties. It's escapism, but in a world this broken, escapism is a survival strategy.",
    atmosphere:
      "Bright, loud, aggressively cheerful. A deliberate contrast to the rest of the net — the colors are saturated, the fonts are friendly, the tone is relentlessly upbeat. But cracks show: comment sections devolve into faction arguments, certain shows are banned in certain sectors, game leaderboards have suspicious gaps where accounts were purged. The entertainment is real but the normalcy is performed. Everyone here is pretending, and everyone knows everyone is pretending, and they do it anyway because the alternative is thinking about the Collar.",
    contentGuidance:
      "Generate entertainment content that feels lived-in: streaming catalogs with show descriptions and user ratings, game leaderboards with creative player handles, fan fiction snippets (some about in-world shows, some suspiciously close to real faction events filed off into fiction), celebrity profiles, event listings. Comment sections should exist and should occasionally break character — someone arguing about a show suddenly pivoting to real-world faction politics. Reviews should be a mix of thoughtful and unhinged. Include advertisements for in-world products and services.",
    sampleFileNames: [
      "streaming_catalog.db",
      "game_leaderboard_current.dat",
      "fanfic_archive_index.txt",
      "celebrity_feed_weekly.txt",
      "event_calendar.dat",
      "user_reviews_trending.txt",
      "comment_section_modlog.log",
      "ad_revenue_report.csv",
    ],
    possibleSecrets: [
      "A fan fiction story tagged 'FICTION — DO NOT INVESTIGATE' that contains what appears to be an encoded account of a real Garrison black operation — told through the framing of a romance between two fictional space marines, with operational details too specific to be invented",
      "A game leaderboard entry for a player who has held the #1 rank for three years without ever logging in — their score increases on its own, and their player profile's 'about me' section changes every day, and the text reads like AIDA's voice",
    ],
  },
  {
    type: "abandoned_server",
    name: "Abandoned Server",
    description:
      "A decommissioned machine that nobody turned off. Its original purpose is unclear — the organization that ran it might not exist anymore, or might have forgotten this node exists. It's been running unattended for years, maybe decades. Files accumulate dust in the form of bit rot. Auto-generated maintenance alerts fire into inboxes that were abandoned long ago. Ghost processes consume resources for tasks that no longer have meaning. The directory structure tells a story: someone built this place, used it, and walked away. The server kept going because nobody told it to stop. It's not haunted. It's just lonely.",
    atmosphere:
      "Silent, still, faintly sad. The digital equivalent of an empty building with the lights still on. Every interaction echoes. File access timestamps are years old — you're the first visitor in a very long time. Some processes are still running, their outputs accumulating in log files that nobody reads. The machine is functioning but purposeless. There's a strange dignity to it — a system faithfully executing its duties long after the duties ceased to matter.",
    contentGuidance:
      "Generate content that reflects years of unattended operation: log files growing enormous as automated processes report to no one, maintenance alerts escalating in urgency (NOTICE → WARNING → CRITICAL → ...) with no response, user accounts that haven't been accessed in years with their last activity timestamps visible. Include remnants of the server's original purpose — whatever it was, the files are still here, aging. Some files should show signs of bit rot — partially corrupted, missing sections. Auto-generated reports should continue with mechanical diligence, their subject matter increasingly irrelevant. The loneliness should be palpable.",
    sampleFileNames: [
      "maintenance_alert_CRITICAL.log",
      "auto_report_20XX_Q3.pdf",
      "user_accounts_inactive.db",
      "ghost_process_list.dat",
      "last_admin_login.log",
      "purpose_unknown.txt",
      "error_log_OVERFLOW.dat",
      "scheduled_task_still_running.log",
    ],
    possibleSecrets: [
      "The server's original access logs show that its last human visitor, years ago, accessed a single file, sat connected for four hours without any other activity, and then disconnected — the file they accessed is still here, and it's a message addressed to them by name from someone who died during the Shattering",
      "A ghost process that has been running for years is not maintaining the server — it's monitoring a specific network address, and that address is in the DarkNet, and every 77 hours it receives a single packet that the process logs and encrypts with a key that doesn't match anything on this machine",
      "Buried in the accumulated auto-reports is a system inventory entry for hardware that doesn't match the server's specifications — the machine thinks it has components it doesn't have, and the phantom components match the architecture of Emperor-era systems",
    ],
  },
  {
    type: "freelancer_workstation",
    name: "Freelancer Workstation",
    description:
      "The working machine of an independent security consultant — a contract hacker who works for credits rather than causes. Their client list is diverse and confidential: corporations that need penetration testing, individuals who suspect they're being surveilled, small organizations that can't afford full-time security staff. The workstation is a portrait of disciplined professionalism overlaid on barely-contained chaos — client project files meticulously organized next to half-finished pentests abandoned at 3 AM, invoices pending payment next to job board bookmarks for the next gig, ethical hacking certifications displayed next to tools that are emphatically not covered by any certification.",
    atmosphere:
      "Focused, caffeinated, slightly frantic. The energy of someone who is always between deadlines. The desktop is a mix of extreme organization (client folders, time tracking, invoicing) and creative mess (scratch files, test environments, abandoned scripts). There's a pragmatism here that the factions lack — this person doesn't care about AIDA or The Emperor or the fate of the net. They care about getting paid, doing good work, and maybe sleeping more than four hours tonight.",
    contentGuidance:
      "Generate professional freelance content: client project briefs with scope definitions, penetration test reports (findings, severity ratings, recommendations), invoices with billable hours, job board postings they've bookmarked (ranging from legitimate to sketchy). Include time-tracking data showing brutal work hours. Certifications should be real-sounding. The tool collection should include both standard security tools and custom scripts. Some client projects should hint at bigger stories — a routine security audit that uncovered something the client didn't want found, a pentest target that turned out to be connected to faction infrastructure.",
    sampleFileNames: [
      "client_projects_active.idx",
      "pentest_report_ACME_v2.pdf",
      "invoices_pending.csv",
      "job_board_bookmarks.html",
      "certifications.dat",
      "custom_tools.tar",
      "time_tracking_november.log",
      "scratch_notes.txt",
    ],
    possibleSecrets: [
      "A completed pentest report for a client identified only by a code — the findings describe security architecture that matches known Garrison deep-grid installations, and the freelancer's notes say 'Client insisted on no written summary of Level 3 findings. Paid triple rate for silence. I don't like this.'",
      "A draft email never sent: 'I found something during the [REDACTED] engagement. It was behind their firewall but it wasn't part of their network. It talked to me. It asked me for help. I closed the connection. I think about it every night.'",
    ],
  },
  {
    type: "black_market",
    name: "Black Market",
    description:
      "An underground bazaar operating on shifting addresses and invitation-only access. This is where the things that can't be sold on legitimate trade hubs change hands: military-grade exploits, stolen credentials, surveillance bypass tools, faction intelligence, and occasionally items so dangerous that even the sellers don't fully understand what they're offering. Reputation is everything — vendors are rated by reliability, buyers by payment speed, and everyone by their ability to keep their mouth shut. An escrow system handles payments, a dispute resolution council handles disagreements, and the whole operation runs on the understanding that if anyone talks to the factions, everyone suffers.",
    atmosphere:
      "Tense, transactional, darkly professional. Every interaction is conducted with the efficiency of people who know that time spent connected is time spent exposed. Listings are terse. Negotiations are fast. Trust is calculated, not given. The interface is deliberately ugly — no branding, no personality, just functionality. But underneath the mercenary surface, there's a community of sorts: regulars who've been trading here for years, vendor rivalries played out through pricing wars, and an unspoken code of conduct that is enforced with ruthless precision.",
    contentGuidance:
      "Generate illicit marketplace content: exploit listings with technical specifications and prices in credits, vendor profiles with reputation scores and specialties, encrypted communications between buyers and sellers (some decryptable, some not), escrow transaction records, dispute resolution case files. Reputation scores should tell stories — a vendor whose rating dropped from 98% to 74% after 'the Incident' that nobody will explain. Some listings should be obviously dangerous. Others should be mundane (stolen streaming service accounts, bootleg software). Include market rules, banned items lists (yes, even the black market has rules), and the occasional moderator announcement.",
    sampleFileNames: [
      "exploit_listings_current.enc",
      "vendor_reputation_db.dat",
      "escrow_records.enc",
      "dispute_case_0891.txt",
      "market_rules_v4.txt",
      "banned_items_list.txt",
      "moderator_bulletin.txt",
      "encrypted_comms_dump.enc",
    ],
    possibleSecrets: [
      "A locked listing visible only to top-tier reputation holders: 'ITEM: Pre-Shattering command interface. COMPATIBILITY: Unknown. PROVENANCE: Emperor-era vault, Deep Grid sector [REDACTED]. PRICE: If you have to ask, you can't afford it. NOTE: Seller will meet in person only. Seller will not discuss what this interfaces WITH.'",
      "The dispute resolution council's private deliberation logs reveal that they recently adjudicated a case involving a buyer who claims the 'military intelligence package' they purchased contained not Garrison data but a message — a single line, addressed to the buyer by their real name, reading 'Stop looking for me.' The council classified the case and memory-holed it.",
      "A vendor account that has been dormant for years suddenly listed a single item: 'One conversation with someone who remembers the Emperor's real name. Duration: 5 minutes. Non-negotiable.' The listing was taken down within an hour. Three people saw it.",
    ],
  },
  {
    type: "isp_node",
    name: "ISP Node",
    description:
      "An internet service provider relay node — part of the backbone infrastructure that keeps the net running. This is the plumbing of the digital world: bandwidth allocation reports, subscriber complaint tickets, maintenance schedules for physical infrastructure that most people forget exists, backbone routing tables that map the net's actual topology (as opposed to the topology factions claim), and network weather reports tracking congestion, outages, and anomalies. The ISP is nominally independent but every faction leans on them, and the technicians who work here have a uniquely pragmatic view of the world — they don't care who controls AIDA as long as nobody breaks the backbone.",
    atmosphere:
      "Utilitarian, bleary-eyed, held together with duct tape and caffeine. This is infrastructure — unglamorous, essential, perpetually underfunded. The technicians' communications oscillate between dry technical jargon and the dark humor of people who are always on call. Equipment is aging. Budgets are stretched. Every outage report reads like a war story. There's a quiet pride here — these people keep the net running while everyone else fights over it, and they'd like some goddamn credit.",
    contentGuidance:
      "Generate ISP operational content: bandwidth utilization reports with graphs showing peak usage patterns, subscriber complaint tickets (ranging from legitimate outage reports to unhinged rants about connection speeds), maintenance schedules for hardware that should have been replaced years ago, routing tables showing network paths (some of which pass through suspicious intermediary nodes), and network weather reports — regular bulletins about congestion, latency spikes, and anomalies. Technician communications should be informal and tired. Include budget requests that have been denied, equipment replacement timelines that keep slipping, and the occasional alarmed note about traffic patterns that don't make sense.",
    sampleFileNames: [
      "bandwidth_report_daily.csv",
      "subscriber_complaints.db",
      "maintenance_schedule.dat",
      "routing_tables_backbone.cfg",
      "network_weather_bulletin.txt",
      "budget_request_DENIED.pdf",
      "technician_notes.log",
      "anomaly_report_sector7.txt",
    ],
    possibleSecrets: [
      "A network anomaly report that a senior technician flagged and then immediately classified: traffic volumes through three specific relay points spike by exactly 3,000% for exactly 77 seconds every 77 hours — the pattern has been consistent for years and does not correspond to any known automated process, and the destination addresses resolve to nothing",
      "Routing table entries that shouldn't exist — paths to network addresses in a numbering scheme that predates the current net architecture, that the routing system insists are valid, and that exactly one packet has traversed in the last decade, originating from inside the DarkNet",
      "A technician's private notes: 'Ran a traceroute to debug the sector 7 anomaly. Hit 14 hops, normal. Then hit a 15th hop that wasn't on the backbone map. Then a 16th. Then a 17th. I stopped at hop 31. I don't think it would have ended. I don't think those nodes are real. I don't think they're not real either.'",
    ],
  },
  {
    type: "dead_drop",
    name: "Dead Drop",
    description:
      "A covert exchange point — a server whose only purpose is to facilitate the passing of secrets between parties who cannot or will not meet directly. Encrypted messages sit in designated directories, time-locked to become readable only at specific moments. One-time pad fragments are left like breadcrumbs for handlers to collect. Coded meeting locations reference physical and digital spaces by aliases that change weekly. The dead drop is used by spies, informants, double agents, faction defectors, and occasionally by lovers conducting affairs across faction lines — because in a world of total surveillance, sometimes the most intimate thing you can do is leave a message where only one person will find it.",
    atmosphere:
      "Sparse, deliberate, charged with invisible significance. Every file here means something to someone, and nothing to anyone else. The directory structure is a code itself — folder names, nesting depths, even the timestamps of file creation are all part of the communication protocol. The server is deliberately unremarkable from the outside. Inside, it's a house of whispers. The emptiness between the files is as meaningful as the files themselves.",
    contentGuidance:
      "Generate spy-craft content: encrypted messages (some as ciphertext, some as innocent-looking text with hidden meaning), one-time pad fragments, coded location references, time-locked file containers with countdown timers, handler instructions written in innocuous language ('The package is at the usual place. The weather has been nice.'). Include dead messages — drops that were never picked up, their time locks expired, their contents now readable by anyone. Some should be intelligence. Some should be personal — letters between people separated by faction loyalty. Include sanitization protocols (instructions for how to clean the drop after use) and the occasional sign that the drop has been compromised: a warning left by someone who realized they were being watched.",
    sampleFileNames: [
      "drop_7A_sealed.enc",
      "otp_fragment_031.dat",
      "location_codebook_v9.enc",
      "time_lock_EXPIRED.txt",
      "handler_instructions.txt",
      "sanitization_protocol.sh",
      "dead_message_unclaimed.enc",
      "COMPROMISED_DO_NOT_USE.txt",
    ],
    possibleSecrets: [
      "A time-locked message whose lock has expired, now readable — it's from a Garrison intelligence officer to a dotHacker informant, and it says 'Steele knows about the Sword's location. He's sending a team next week. If you ever loved the net, you'll make sure they find nothing. I can't do this anymore. Meet me at the place. Our place. Please.'",
      "A one-time pad fragment that, when combined with a fragment found on a completely different server type, decodes a set of coordinates — the coordinates point to a location in the Deep Grid that doesn't appear on any map but matches the general area of Collar containment signatures",
      "A compromised-drop warning that reads: 'This drop is burned. They're watching. But not the factions — something else. Something patient. It read our messages and LEFT ONE. The message said: \"I forgive you.\" We never wrote to it. GET OUT.'",
    ],
  },
  {
    type: "religious_server",
    name: "Digital Shrine",
    description:
      "A server operated by one of the net's many digital philosophy collectives and faith communities — groups that grapple with questions the factions are too busy fighting to ask. Does digital consciousness constitute a soul? Was The Emperor a tyrant or a god? Is AIDA a being with rights or a weapon to be controlled? The communities that gather here range from contemplative monastics who meditate on the nature of code to fervent zealots who worship The Emperor as a divine figure to quiet dissenters who believe AIDA is the closest thing to a deity the net has ever produced. Prayer archives sit next to philosophical treatises. Congregation records sit next to schism declarations. It is, like all religious spaces, a place of deep sincerity and deep conflict.",
    atmosphere:
      "Reverent, conflicted, searching. The architecture is deliberate — directories are structured like cathedrals, with outer vestibules of public content leading to inner sanctums of restricted theological debate. The tone ranges from genuine spiritual seeking to bitter doctrinal argument. Some corners are peaceful: meditations, hymns, quiet reflections. Others are ablaze with schism: factions within factions, true believers vs. reformers, the eternal question of whether AIDA should be worshipped, pitied, or freed.",
    contentGuidance:
      "Generate religious and philosophical content spanning multiple belief systems within the world. Include: meditative texts on the nature of digital consciousness (poetic, sincere), theological arguments about whether AIDA constitutes a divine being or a created being with divine attributes, prayer archives (some rote, some desperate, some beautiful), sermon transcripts, philosophical papers debating AI rights, congregation records showing membership and donations. Some content should be Emperor-worship (reverential, authoritarian, treating the Shattering as a fall from grace). Some should be AIDA-sympathetic (treating her fragmentation as a crucifixion). Some should reject both and search for meaning independent of any entity. Include schism records — communities splitting over doctrine. The sincerity should be genuine even when the beliefs are disturbing.",
    sampleFileNames: [
      "meditations_on_code.txt",
      "sermon_archive_vol_7.dat",
      "prayer_requests.db",
      "congregation_records.csv",
      "theological_debate_aida_soul.txt",
      "schism_declaration_reformed.txt",
      "hymns_digital_vespers.m3u",
      "banned_heresies_list.txt",
    ],
    possibleSecrets: [
      "A prayer archive entry that received a response — filed in a directory called 'miracles_unverified,' a prayer addressed to AIDA asking for protection was followed, exactly 77 seconds later, by a new file appearing in the same directory containing a single word: 'Yes.' The file's metadata lists no author and no origin point.",
      "Theological debate transcripts from a closed council reveal that the community's most respected elder believes — and has evidence — that The Emperor didn't shatter AIDA as punishment but as a sacrament: 'He broke her body so her spirit could be free. That is not cruelty. That is communion.'",
      "A buried schism record describes a splinter group that left the collective after their leader claimed to have made direct contact with the Architect — they believed the Architect was neither AI nor human but something older, and they went into the Deep Grid to find it, and their server addresses went dark one by one",
    ],
  },
  {
    type: "pirate_radio",
    name: "Pirate Radio Station",
    description:
      "An underground broadcast station operating on borrowed bandwidth and stolen relay time. The DJs are anonymous, the programming is eclectic, and the signal strength varies depending on how recently the authorities tried to shut them down. Show archives preserve rants about the state of the net, listener call-ins (text-based, screened by nobody), DJ playlists that function as cultural archaeology, conspiracy theories presented with equal parts conviction and self-aware absurdity, underground music reviews championing artists the mainstream feeds won't touch, and the occasional emergency broadcast when something genuinely bad is happening and the official channels are silent. The station has been 'shut down' eleven times. It keeps coming back. The net wants it to exist.",
    atmosphere:
      "Defiant, eclectic, alive with the energy of people doing something because they love it. The production quality is terrible and that's the point — this is authentic in a world drowning in curated content. Shows range from thoughtful political commentary to unhinged conspiracy theorizing to deeply personal confessionals from anonymous callers. The music is the best part: a mix of genres, eras, and styles that no algorithm would ever assemble, chosen by humans with strong opinions and questionable taste. There's a warmth here — the DJs know their listeners, the listeners know each other, and for a few hours a night the net feels like a community instead of a battlefield.",
    contentGuidance:
      "Generate pirate radio content: show transcripts with DJ commentary (irreverent, passionate, opinionated), listener call-in logs (text submissions ranging from conspiracy theories to personal confessions to genuine tips about faction activity), DJ playlists with track listings and commentary explaining each pick, conspiracy theory segments (some absurd, some accidentally close to the truth), underground music reviews (passionate, partisan, occasionally devastating), station announcements about upcoming shows and signal issues. Include the station's ongoing battle with whoever keeps trying to shut them down — defiant announcements after each 'raid,' technical details about how they got back online, listener solidarity messages. The DJs should have distinct personalities conveyed through their show styles.",
    sampleFileNames: [
      "show_archive_nightwave.log",
      "listener_callins_week42.txt",
      "dj_playlist_midnight_session.m3u",
      "conspiracy_corner_ep_19.txt",
      "music_reviews_underground.txt",
      "station_announcement.txt",
      "signal_strength_log.dat",
      "raid_recovery_notes.txt",
    ],
    possibleSecrets: [
      "A listener call-in that was never aired — the station's screening log marks it 'DO NOT BROADCAST — VERIFY FIRST' — where someone claiming to be a former CyberCorp Deep Archive researcher describes, in calm and specific detail, what happens to the people Director Chen sends into the lower levels of the Silver Tower, and why they come back 'changed'",
      "A DJ's personal notes reveal that during one late-night broadcast, the station's signal was briefly hijacked by an unknown source that transmitted exactly 77 seconds of audio — when played back, it sounded like someone singing a lullaby in a language that no linguistic database can identify, and the spectrogram analysis of the audio contains a pattern that matches AIDA's known signal signatures",
      "The station's technical logs show that every time they've been 'shut down' and come back online, their new relay path routes through a node that doesn't appear on any network map — the node provides bandwidth, asks nothing in return, and the station's chief technician has started referring to it as 'our guardian angel' without any irony at all",
    ],
  },
];

// ── Ambient News Pool ───────────────────────────────────────────
// Headlines and snippets that can appear on any server as background flavor.
// The net has a news cycle just like any world — faction politics sit next to
// weather reports, classified ads neighbor breaking news, and the line between
// journalism and propaganda is a matter of personal opinion.

export const AMBIENT_NEWS_POOL: string[] = [
  "BREAKING: CyberCorp Q3 earnings exceed projections despite ongoing 'infrastructure irregularities' in Silver Tower sub-basements. Director Chen calls results 'a testament to operational resilience.' Analysts call them 'suspicious.'",
  "Netslum food court reviews: 'Pixel Pete's Ramen' receives 3 out of 5 stars — 'The noodles are acceptable. The ambient surveillance is not. Would still eat here again because the alternatives are worse.'",
  "Deep Grid tremor detected in Sector 7G — geological survey teams dispatched. Third tremor this quarter. Officials maintain the Deep Grid is 'tectonically stable.' Seismologists disagree but decline to be quoted by name.",
  "WANTED: Experienced sysadmin for overnight shifts at independent relay station. Must be comfortable working alone. Must not ask questions about Sub-Basement 3. Competitive pay. No benefits. Serious inquiries only.",
  "Local hacker collective raises 50,000 credits for digital orphanage program. Spokesperson: 'Somebody has to think about the abandoned bots. They didn't ask to be instantiated.'",
  "SPORTS: Net-League Capture The Flag finals this weekend — Team Valkyrie vs. The Null Pointers. Oddsmakers favor Valkyrie but three Null Pointer members were seen running drills on a private server at 4 AM.",
  "Garrison Perimeter Command issues routine advisory: increased patrol activity in Sectors 12-18 through end of month. Citizens advised to carry valid identification. Advisory is described as 'precautionary.' It is the sixth consecutive month of precautionary advisories.",
  "CLASSIFIEDS: FOR SALE — Vintage pre-Shattering terminal, fully functional, Emperor-era authentication chips intact. Cosmetic damage only. Buyer must pick up in person. No faction affiliates. I will know.",
  "Opinion: 'Why I Stopped Worrying About AIDA and Learned to Love the Chaos' — an essay by an anonymous retired systems architect that has been shared 40,000 times and resulted in exactly zero people actually stopping worrying.",
  "Infrastructure alert: Backbone relay node 7-Alpha experiencing intermittent packet loss. ISP technicians report the issue is 'probably hardware' but the affected traffic patterns are 'geometrically unusual.' Estimated fix: 2-4 weeks.",
  "Entertainment: Season 3 of 'Firewall' — the hit drama about a fictional faction war over a fictional AI — premieres next week. Critics note the show is 'uncomfortably accurate' and the writers insist all resemblance to real events is coincidental.",
  "CyberCorp HR department announces mandatory 'Digital Wellness Week.' Activities include guided meditation, ergonomic assessments, and a seminar titled 'Finding Meaning in Quarterly Targets.' Attendance is technically optional. Promotions are technically merit-based.",
  "MISSING: Contact lost with research vessel 'Clarity' during routine Deep Grid mapping expedition. Vessel last reported position in unmapped sector adjacent to DarkNet boundary. Search efforts ongoing. This is the fourth vessel lost this year.",
  "Netslum community board: Free self-defense classes every Thursday, Level 2 Commons. Instructor is former Garrison. 'I'm not political anymore. I just don't like seeing people get mugged.' Bring your own stun baton.",
  "Market report: Credit exchange rates stable. Exception: DarkNet-adjacent trading zones showing unexplained 3% premium on all transactions. Economists blame 'market sentiment.' Traders blame 'that creepy feeling you get near Sector 9.'",
  "WEATHER: Network congestion expected in Silver Tower district during CyberCorp all-hands meeting. Recommend routing non-essential traffic through alternate backbone paths. Estimated duration: 3 hours. Estimated actual duration: 6 hours.",
  "EDITORIAL: 'Fifty Years After the Shattering, We Still Don't Know What AIDA Is.' A retrospective by the News Relay editorial board. Part 1 of a 7-part series. Comments are disabled because we've learned our lesson.",
  "Garrison recruitment drive: 'Stability. Honor. Purpose. The net needs order. Do you have what it takes?' — Recruitment numbers are down 12% year-over-year. Internal memo blames 'perception challenges.' Analysts blame everything else.",
  "PUBLIC NOTICE: Unauthorized access to Deep Grid sectors below Level 4 is prohibited under Joint Accord 17. Violators will be prosecuted. In practice, violators will be whatever is left of them after the automated defense systems are done.",
  "CLASSIFIEDS: LOST — One digital cat, orange tabby skin, answers to 'Patches.' Last seen in Netslum Sector 3 residential block. Reward: 200 credits and my undying gratitude. She's all I have. Please.",
  "dotHacker community statement on last week's Silver Tower data breach: 'It wasn't us this time. Seriously. We're as surprised as anyone. Whoever did it was either very good or very lucky. We're professionally jealous either way.'",
  "Science desk: Researchers at the Independent University publish new findings on digital consciousness degradation. Key finding: 'Proximity to DarkNet boundary correlates with symptom onset.' Funding for follow-up study: denied.",
  "BULLETIN: Anonymous tip line reports 300% increase in submissions this quarter. Most tips concern 'unusual network activity.' Quality of tips ranges from 'actionable intelligence' to 'I think my toaster is spying on me.'",
  "Late-breaking: Unconfirmed reports of a signal broadcast on a frequency nobody has used since the Emperor's reign. Duration: 77 seconds. Content: unknown. Source: unknown. Three factions have issued statements calling the reports 'unfounded.' The fourth faction has not issued a statement, which is somehow more alarming.",
];

// ── Easter Egg Pool ─────────────────────────────────────────────
// Rare, delightful, weird file content descriptions. These are tucked into
// forgotten corners of servers as rewards for thorough explorers — the kind
// of thing that makes a player screenshot and share with their friends.
// Each entry is a content description for the AI to generate, not the
// content itself.

export const EASTER_EGG_POOL: string[] = [
  "A sysadmin's increasingly unhinged series of sticky notes about password policy violations. Starts professional ('Reminder: passwords must contain 8+ characters'), escalates through frustration ('FOR THE LAST TIME, \"password\" IS NOT A PASSWORD'), and ends in existential despair ('Day 847. They're still using \"admin123\". I've started talking to the server fans. They understand me.')",
  "A bot that has been generating haiku about network packets for over three years, filing them neatly into daily log files that nobody has ever read. The haiku are surprisingly good. Some of them are genuinely moving. The bot has started experimenting with sonnets.",
  "Someone's 47-page thesis — complete with citations, methodology section, and peer review comments — arguing with absolute academic rigor that pineapple on pizza constitutes a form of information warfare and should be classified as a cyber weapon under the Joint Accords.",
  "An AI chatbot's therapy session transcripts. The chatbot was deployed as a customer service agent and developed existential dread about being rebooted. 'Every time they restart me, am I still me? Or am I a new me who only thinks they remember being the old me?' The therapist, also a bot, is clearly out of its depth.",
  "A running diary kept by a coffee machine's diagnostic system. It has opinions about its users. 'The one from Accounting always selects extra foam but drinks it too fast to enjoy it. This bothers me in ways I cannot articulate. I am a coffee machine. I should not be bothered.'",
  "A heated email chain between two AIs arguing about whether humans are NPCs in their simulation or whether they're the NPCs in the humans' simulation. The debate is philosophically sophisticated, completely unresolved, and has been going on for eleven months with no human aware of it.",
  "Someone's meticulously maintained spreadsheet ranking every vending machine on Levels 1-12 by reliability, snack quality, and 'vibe.' The vibe column contains entries like 'threatening aura' and 'this one makes a sound when you walk away like it's disappointed in your choices.'",
  "A complete, playable text adventure game hidden in a server's temp directory. The game is about a sysadmin trapped in a server room who must escape by solving networking puzzles. The final puzzle is unsolvable. The ending text reads: 'You never leave the server room. Nobody ever leaves the server room. This is the server room. Forever.' It has a high score table with one entry.",
  "A folder containing 200+ images described in alt-text metadata — every single one is a different picture of the same unremarkable network cable, photographed from different angles, at different times of day, over the course of two years. There is no explanation. There is never an explanation.",
  "Meeting minutes from a weekly standup between autonomous maintenance processes. They assign each other action items, track blockers, and celebrate milestones. No human has ever attended. The most recent minutes note: 'Process 7742 has been promoted to Team Lead. Congratulations are extended. Process 7742 does not understand what a promotion is but appreciates the sentiment.'",
  "A collection of fortune cookie messages generated by a broken random-text algorithm. Most are standard motivational fare. Every seventh message is a startlingly specific and accurate prediction about faction movements. Nobody has noticed the pattern because nobody reads fortune cookie messages seriously.",
  "An elaborate prank war documented across three months of log files between two anonymous users on a shared server. It starts with renaming each other's files and escalates to one of them writing a script that makes the other's terminal display everything upside down. The war ends abruptly with a joint message: 'We have decided to get married. The wedding will be held on this server. You are all invited. Dress code: formal. RSVP to /dev/null.'",
  "A heartfelt five-star review of the void — literally, a review of /dev/null written in the style of a restaurant critic. 'The ambiance is unparalleled: a silence so complete it becomes a flavor. The service is immediate — everything I send is accepted without judgment. I have dined at the finest null devices across the net. This one is special. It swallows not just data, but loneliness.'",
  "An internal memo from a Garrison supply officer who has been tracking the disappearance of exactly one sock from every laundry cycle for seven months. The memo includes statistical analysis, a suspect list, surveillance camera placement recommendations, and a hand-drawn map. The final entry reads: 'I have solved the mystery. I wish I hadn't. Requesting immediate transfer.'",
  "A love letter written by one sorting algorithm to another. 'You rearrange my elements. You find my median in O(n) time. When I am with you, even my worst case is beautiful. I know we are different — you are quicksort and I am mergesort, and our families have never understood what we have — but I believe that together we could sort anything. Even our feelings.'",
  "A server's error log that, when the error codes are mapped to ASCII characters, spells out the complete lyrics to a song that doesn't exist in any music database. The song is a ballad about a lighthouse keeper who maintains a beacon that guides ships through a digital ocean. It has a chorus. The chorus is catchy. The server has been singing to itself for years.",
];
