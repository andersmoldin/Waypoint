# Waypoint

En extension för Azure DevOps som visar var arbetsobjekt befinner sig i en livscykel, så att den som tittar snabbt ser vad som är på väg och vem som ska föra det vidare.

## Livscykeln

**Livscykel**:
En ordnad lista av faser som ett objekt rör sig genom från idé till avveckling.
_Avoid_: Flöde, process (krockar med process som objekt)

**Fas**:
Ett steg i en livscykel, till exempel _Under utveckling_ eller _I produktion_. Ett objekt befinner sig i exakt en fas åt gången.
_Avoid_: Steg, status, state

**Fasgrupp**:
En namngiven samling faser som visas tillsammans. Vi har tre: _Före produktion_ (Idéfas till och med Under utveckling), _Drift_ (I produktion och Pausad) och _Avslut_ (Under avveckling, Avvecklad och Avfärdad).
_Avoid_: Flik, skede, kategori

**Pausad**:
En fas för en process som tillfälligt inte körs, till exempel medan verksamheten överväger att avveckla den.
_Avoid_: Vilande, stoppad

**Avvecklad**:
En fas för en process som har varit i produktion och har tagits ur drift.
_Avoid_: Avslutad, stängd

**Avfärdad**:
En fas för en idé som utvärderats och inte ska genomföras. Processen har aldrig varit i produktion.
_Avoid_: Avvecklad, avslagen

**Aktuellt läge**:
En fri beskrivning av vad som händer med en process just nu och vad nästa steg är.
_Avoid_: Status, state

**Väntar på**:
Det steg, den person eller den organisation som en process väntar på för att komma vidare. Är tomt när arbetet pågår utan att vänta på något.
_Avoid_: Ägare, ansvarig, blockerad av

**Markering**:
En ja/nej-uppgift på ett objekt som visas som etikett på kortet när den är ja. Hos oss är det _Förbättring pågår_.
_Avoid_: Flagga, tagg

**Förbättring**:
Vidareutveckling eller rättning av en process som är i produktion. Den har ingen egen fas och inget eget objekt, utan markeras på processen medan den pågår.
_Avoid_: Ändringsärende, ny version

## Det som placeras i livscykeln

**Objekt**:
Det som placeras i en fas och följs genom livscykeln. I vår organisation är objektet en process.
_Avoid_: Item, kort

**Grupp**:
Objektets förälder, som samlar flera objekt. I vår organisation är gruppen en robot.
_Avoid_: Kategori, container

**Bortvald grupp**:
En grupp som en Project Administrator har valt att inte visa. Varken gruppen eller dess objekt syns på brädan.
_Avoid_: Dold grupp, filtrerad grupp

**Robot**:
Vårt namn på en grupp: en namngiven RPA-robot, till exempel Bodil eller Dagny, som kan ha flera processer. Kan sakna namn och bara ha en beskrivande rubrik innan den namnges.
_Avoid_: Bot

**Process**:
Vårt namn på ett objekt: en RPA-process som tillhör en robot, namngiven med löpnummer, robot och kort namn, till exempel `PROCESS_103.Bodil.HamtaUnderlag`. Kan sakna namn och löpnummer och bara ha en beskrivande rubrik.
_Avoid_: Automation, flöde

**Intressent**:
En part utanför teamet som tittar på livscykeln och som en process kan vänta på.
_Avoid_: Kund, beställare

## Att visa

**Roll**:
Det ett fält används till på kortet: _Aktuellt läge_, _Väntar på_ eller _Markering_. Varje roll är valfri och pekas på ett fält av en Project Administrator.
_Avoid_: Kolumn, attribut

**Detaljpanel**:
Sidopanelen som öppnas med ett klick på ett kort. Den visar objektets titel som rubrik, de valda fälten och en knapp till work item:et. Förvalet är fälten som har en roll.
_Avoid_: Popup, dialog

## Att filtrera på

**Filterfält**:
Ett sätt att avgränsa brädan som en Project Administrator har ställt in, utöver nyckelord och grupp: ett val, flerval via taggprefix, text som börjar med, eller ifyllt eller tomt.
_Avoid_: Kolumnfilter, fält

**Taggprefix**:
Den inledande text som gör att en tagg hör till ett filterfält, till exempel `IT-stöd: `. Det ingår i taggen men visas inte i filtret.
_Avoid_: Taggrupp, kategori

**Urbockad tagg**:
En tagg med taggprefixet som en Project Administrator har valt att inte erbjuda i filtret. Nya taggar med prefixet erbjuds utan inställning.
_Avoid_: Dold tagg, borttagen tagg

**IT-stöd**:
De IT-system som en process använder. En process kan använda flera.
_Avoid_: System, applikation

**Förvaltningsområde**:
Det förvaltningsområde som en process hör till.
_Avoid_: Avdelning, område

**GKL**:
Ett globalt kopplat löpnummer i punktnotation, till exempel `14.1.0`. Varje process har exakt ett.
_Avoid_: Löpnummer (krockar med processens nummer)
