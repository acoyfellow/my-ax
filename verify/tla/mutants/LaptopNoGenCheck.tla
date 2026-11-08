---- MODULE LaptopNoGenCheck ----
EXTENDS Naturals, FiniteSets

CONSTANTS MaxSockets

VARIABLES generation, user, catalog, sockets, nextGen, cachedCatalog

vars == <<generation, user, catalog, sockets, nextGen, cachedCatalog>>

None == 0

Init ==
  /\ generation = None
  /\ user = None
  /\ catalog = None
  /\ sockets = {}
  /\ nextGen = 1
  /\ cachedCatalog = None

LaptopConnects ==
  /\ nextGen <= MaxSockets
  /\ sockets' = {s \in sockets : s.open = FALSE} \cup {[gen |-> s.gen, open |-> FALSE] : s \in {x \in sockets : x.open}} \cup {[gen |-> nextGen, open |-> TRUE]}
  /\ generation' = nextGen
  /\ user' = nextGen
  /\ catalog' = None
  /\ cachedCatalog' = None
  /\ nextGen' = nextGen + 1

LaptopSaysHello(s) ==
  /\ s \in sockets
  /\ s.open
  /\ IF TRUE
       THEN /\ catalog' = s.gen
            /\ cachedCatalog' = s.gen
       ELSE UNCHANGED <<catalog, cachedCatalog>>
  /\ UNCHANGED <<generation, user, sockets, nextGen>>

SocketCloses(s) ==
  /\ s \in sockets
  /\ sockets' = sockets \ {s}
  /\ IF TRUE
       THEN /\ generation' = None
            /\ user' = None
            /\ catalog' = None
            /\ cachedCatalog' = None
       ELSE UNCHANGED <<generation, user, catalog, cachedCatalog>>
  /\ UNCHANGED nextGen

Done ==
  /\ nextGen > MaxSockets
  /\ sockets = {}
  /\ UNCHANGED vars

Next ==
  \/ LaptopConnects
  \/ \E s \in sockets : LaptopSaysHello(s)
  \/ \E s \in sockets : SocketCloses(s)
  \/ Done

Spec == Init /\ [][Next]_vars

CatalogBelongsToCurrentLaptop == catalog /= None => catalog = generation

UserBelongsToCurrentLaptop == user /= None => user = generation

ConnectedWhileCurrentSocketOpen == (\E s \in sockets : s.open /\ s.gen = generation) \/ generation = None \/ \E s \in sockets : s.gen = generation

CacheMatchesStorage == cachedCatalog = catalog

OldSocketCannotDisconnectNewLaptop == (\E s \in sockets : s.gen = generation /\ s.open) => generation /= None
====
