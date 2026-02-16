Scriptname DialogueFollowerScript extends Quest Conditional

GlobalVariable Property pPlayerFollowerCount Auto
GlobalVariable Property pPlayerAnimalCount Auto
ReferenceAlias Property pFollowerAlias Auto
ReferenceAlias Property pAnimalAlias Auto
Faction Property pDismissedFollower Auto
Faction Property pCurrentHireling Auto
Message Property FollowerDismissMessage Auto
Message Property AnimalDismissMessage Auto
Message Property FollowerDismissMessageWedding Auto
Message Property FollowerDismissMessageCompanions Auto
Message Property FollowerDismissMessageCompanionsMale Auto
Message Property FollowerDismissMessageCompanionsFemale Auto
Message Property FollowerDismissMessageWait Auto
SetHirelingRehire Property HirelingRehireScript Auto
Weapon Property FollowerHuntingBow Auto
Ammo Property FollowerIronArrow Auto

Function SetFollower(ObjectReference FollowerRef) native
Function SetAnimal(ObjectReference AnimalRef) native
Function FollowerWait() native
Function AnimalWait() native
Function FollowerFollow() native
Function AnimalFollow() native
Function DismissFollower(Int iMessage = 0, Int iSayLine = 1) native
Function DismissAnimal() native
