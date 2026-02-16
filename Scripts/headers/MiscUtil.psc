Scriptname MiscUtil Hidden

ObjectReference[] Function ScanCellObjects(int formType, ObjectReference CenterOn, float radius = 0.0, Keyword HasKeyword = none) global native
Actor[] Function ScanCellNPCs(ObjectReference CenterOn, float radius = 0.0, Keyword HasKeyword = none, bool IgnoreDead = true) global native
Actor[] Function ScanCellNPCsByFaction(Faction FindFaction, ObjectReference CenterOn, float radius = 0.0, int minRank = 0, int maxRank = 127, bool IgnoreDead = true) global native
Function ToggleFreeCamera(bool stopTime = false) global native
Function SetFreeCameraSpeed(float speed) global native
Function SetFreeCameraState(bool enable, float speed = 10.0) global native
string[] Function FilesInFolder(string directory, string extension="*") global native
string[] Function FoldersInFolder(string directory) global native
bool Function FileExists(string fileName) global native
string Function ReadFromFile(string fileName) global native
bool Function WriteToFile(string fileName, string text, bool append = true, bool timestamp = false) global native
Function PrintConsole(string text) global native
string Function GetRaceEditorID(Race raceForm) global native
string Function GetActorRaceEditorID(Actor actorRef) global native
Function SetMenus(bool enabled) global native
float Function GetNodeRotation(ObjectReference obj, string nodeName, bool firstPerson, int rotationIndex) global native
Function ExecuteBat(string fileName) global native
Actor[] Function ScanCellActors(ObjectReference CenterOn, float radius = 5000.0, Keyword HasKeyword = none) global native
