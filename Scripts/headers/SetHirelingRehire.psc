Scriptname SetHirelingRehire extends Quest

GlobalVariable Property CanRehire Auto
int Property RehireWindow Auto
GlobalVariable Property GameDaysPassed Auto
GlobalVariable Property CanRehireBelrand Auto
GlobalVariable Property CanRehireErik Auto
GlobalVariable Property CanRehireJenassa Auto
GlobalVariable Property CanRehireMarcurio Auto
GlobalVariable Property CanRehireStenvar Auto
GlobalVariable Property CanRehireVorstag Auto
ActorBase Property Belrand Auto
ActorBase Property Erik Auto
ActorBase Property Jenassa Auto
ActorBase Property Marcurio Auto
ActorBase Property Stenvar Auto
ActorBase Property Vorstag Auto

Function DismissHireling(Actorbase myFollower) native
