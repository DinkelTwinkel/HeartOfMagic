Scriptname SL_BookXP_QuestScript extends Quest
{SpellLearning API Test Addon - Grants spell learning XP when reading books.
Demonstrates: RegisterXPSource, GetAllLearningTargets, AddSourcedXP.
Requires: SpellLearning mod (Heart of Magic)}

; === CONFIGURATION ===
float Property XPPerBook = 15.0 Auto
{XP granted per book read, split across all active learning targets}

; === INTERNAL STATE ===
int lastBooksRead = 0

Event OnInit()
    ; Register our custom XP source - this creates a "Book Reading" entry
    ; in the SpellLearning settings panel with multiplier + cap sliders
    SpellLearning.RegisterXPSource("book_reading", "Book Reading")

    ; Track books read stat
    lastBooksRead = Game.QueryStat("Books Read")

    ; Re-register on game load (OnInit only fires once per save)
    RegisterForModEvent("SKSE_LoadGame", "OnGameLoad")

    ; Poll for book reads every 5 seconds
    RegisterForUpdate(5.0)

    Debug.Notification("[BookXP] Initialized - " + XPPerBook + " XP per book")
EndEvent

Event OnGameLoad()
    ; Re-register events on load
    RegisterForModEvent("SKSE_LoadGame", "OnGameLoad")

    ; Re-register source (safe to call multiple times, no-ops if exists)
    SpellLearning.RegisterXPSource("book_reading", "Book Reading")

    ; Sync book count
    lastBooksRead = Game.QueryStat("Books Read")

    ; Resume polling
    RegisterForUpdate(5.0)
EndEvent

Event OnUpdate()
    int currentBooksRead = Game.QueryStat("Books Read")

    if currentBooksRead > lastBooksRead
        int newBooks = currentBooksRead - lastBooksRead
        lastBooksRead = currentBooksRead

        float totalXP = XPPerBook * newBooks as float

        ; Get all active learning targets and grant XP to each
        Spell[] targets = SpellLearning.GetAllLearningTargets()

        if targets.Length == 0
            ; No active learning targets - XP would be wasted
            Debug.Notification("[BookXP] Read " + newBooks + " book(s) but no learning targets set")
            return
        endif

        int granted = 0
        int i = 0
        while i < targets.Length
            if targets[i] != None
                float actual = SpellLearning.AddSourcedXP(targets[i], totalXP, "book_reading")
                if actual > 0.0
                    granted += 1
                endif
            endif
            i += 1
        endwhile

        if granted > 0
            Debug.Notification("[BookXP] +" + totalXP + " XP to " + granted + " spell(s)")
        endif
    endif
EndEvent
