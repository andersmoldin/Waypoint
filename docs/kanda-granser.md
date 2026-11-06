# Kända gränser

## Antal objekt per projekt

v1 dimensioneras för 2 000 objekt per projekt.

| Objekt av objekttypen | Vad användaren ser |
| --- | --- |
| Upp till 2 000 | Alla objekt, utan banner. |
| Fler än 2 000 | De första 2 000 sorterade efter grupp, och en banner med det verkliga totalantalet. |
| Fler än 20 000 | Felrutan med Azure DevOps svar, och ingen bräda. |

Grupperna sorteras efter namn i fast svensk ordning, så att Å, Ä och Ö kommer efter Z och samma objekt kapas för alla. Objekt utan grupp kommer sist och kapas först.

Objekt i bortvalda grupper och objekt som filtret tar bort räknas inte: de tas bort före kapningen, så att ett objekt bortom plats 2 000 går att nå genom att välja bort grupper eller filtrera. Bannerns totalantal gäller det som är kvar.

Azure DevOps vägrar svara på en WIQL-fråga som ger fler än 20 000 träffar (`VS402337`). Hubben hämtar alla objekt av objekttypen med en enda fråga, så över det taket finns inget totalantal att visa i en banner. Hubben skickar då vidare felet i stället för att visa en ofullständig bräda. Hubben frågar på samma sätt efter alla grupper av grupptypen, och samma fel gäller där.

Felrutan över 20 000 är en medveten gräns i v1. Taket ligger långt över de 2 000 objekt som v1 dimensioneras för.

## Bortvalda grupper

Inställningarna erbjuder projektets grupper av grupptypen och de sparade bortvalda grupperna av grupptypen, även en som ligger i ett annat projekt. Varje bortvald grupp av grupptypen som går att läsa går alltså att bocka i igen.

En grupp som bara nås via föräldralänken från ett objekt, till exempel en förälder i ett annat projekt, och som inte redan är bortvald, visas i hubbens grupplista men går inte att välja bort. Det gäller också en sådan grupp som har tagits tillbaka och sparats.

En bortvald grupp sparas med sitt work item-id även när gruppen försvinner eller grupptypen byts. Id:t matchar då ingenting, och gruppen är fortfarande bortvald om den kommer tillbaka. Ett id som inte går att läsa eller är av fel typ visas inte i inställningarna, men sparas kvar.

Döljer bortvalen alla objekt säger brädan det i en rad, så att en tom bräda inte tas för sanningen. Lämnar de något objekt kvar säger den inget. Det går inte att skilja från att en administratör har gjort ett medvetet val.

Bortval är ett val av vy, inte ett skydd. Den som kan läsa ett objekt men inte dess bortvalda grupp ser objektet under No group, eftersom hubben då inte kan se att föräldern är en grupp. Ett sådant objekt göms inte, så att inget försvinner utan väg tillbaka.

## Flikar i länkar

Vald flik ligger i URL:en med fliknamnet, till exempel `?tab=Drift`.

- När hubben visar en bräda skriver den den visade fliken till URL:en, om URL:en inte redan säger den. En kopierad länk visar då samma vy. Kunde URL:en inte läsas skrivs inget förrän användaren väljer en flik, så att en delad länk håller efter en omladdning.
- En länk till en flik som har bytt namn eller tagits bort visar första fliken, utan fel, och URL:en skrivs om till första fliken.
- Hubben läser URL:en när den öppnas. Azure DevOps har ingen händelse för ändrade query-parametrar, så webbläsarens bakåtknapp byter inte flik förrän sidan laddas om.
- `IHostNavigationService` har bara `setQueryParams` för query-parametrar och ingen ersättande variant, så skrivningen vid öppning går samma väg som ett flikbyte. Om den lägger en extra post i webbläsarhistoriken i en riktig värd är inte verifierat.

## Filter i länkar

Filtret ligger i URL:en, till exempel `?tab=Drift&keyword=faktura&group=12,34`. `group` är gruppernas work item-id, eftersom två grupper kan ha samma namn. En länk är alltså giltig även om gruppen byter namn, men säger inget för den som läser den.

- Hubben öppnar filterraden om länken har ett filter. En grupp som inte finns i grupplistan, till exempel en bortvald, räknas inte och skrivs bort ur URL:en. Det gör även ett nyckelord med bara blanksteg. Övriga giltiga grupper i samma länk gäller.
- Filtret sparas inte mellan besök. Det finns bara i URL:en och i den öppna sidan.
- Nyckelordet ligger i klartext i URL:en, som allt annat i sidans adress. Det är sökordet, inte datan.
- Nyckelord söker efter hela den skrivna texten, utan hänsyn till versaler, i objektets titel och gruppens namn. Medan användaren skriver väntar `azure-devops-ui` på en paus på 200 ms innan brädan och URL:en ändras, så att varje tangenttryckning inte ritar om brädan och skriver till URL:en. Stänger användaren raden med filterikonen inom den pausen räknas inte de sista tecknen.
- Filtret gäller alla flikar. Flikarna visar inga siffror, så ett objekt som filtret hittar kan ligga på en annan flik än den som visas. Skärmläsare får antalet över alla flikar.
- Bakåtknappen och webbläsarhistoriken har samma gränser som för [flikar i länkar](#flikar-i-länkar): bakåtknappen ändrar inte filtret förrän sidan laddas om, och varje filterändring skrivs med `setQueryParams`.
- Att ett tomt värde tar bort en parameter är dokumenterat för `setQueryParams` och prövas mot testorgen i end-to-end-testet.
- Ett filterfält ligger i `filter.<filterfältets namn>`, till exempel `?filter.GKL=7.3&filter.Väntar på=filled&filter.IT-stöd=IT-stöd: Dokportalen; IT-stöd: Ärendesystemet`. Ett val har värdet, ifyllt eller tomt har `filled` eller `empty`, och taggar står hela och delas med `; `. Prefixet `filter.` håller namnet isär från sidans övriga parametrar, vad administratören än kallar fältet.
- Ett filtervärde som fältet inte erbjuder räknas inte och skrivs bort ur URL:en, till exempel en urbockad tagg.
- En parameter för ett filterfält som brädan inte har räknas inte, utan fel, men ligger kvar i URL:en. Det gäller också ett filterfält som har bytt namn eller som hubben för stunden måste lämna bort. En länk till ett filter som har bytt namn slutar alltså avgränsa på det, och en gammal parameter börjar avgränsa om ett filterfält får det namnet.
- Att `setQueryParams` och `getQueryParams` klarar parameternamn med blanksteg och å, ä och ö är inte prövat mot en riktig värd.

## Filterfält

En Project Administrator ställer in filterfälten. Filtren tillämpas före kapningen, så ett objekt bortom plats 2 000 går att nå med dem.

- **Ett val** erbjuder picklistans värden. Ett objekt med ett värde som picklistan har tappat går inte att välja fram.
- **Taggprefix** fylls med projektets taggar när hubben öppnas. Rullistan visar taggarna utan prefix, i svensk ordning, och hela taggen matchas. Prefixet hittas utan hänsyn till versaler, eftersom Azure DevOps inte skiljer taggar åt på det sättet. En tagg som bara består av prefixet har inget namn att visa och erbjuds inte.
- **Urbockade taggar** sparas med hela namnet, också när taggen försvinner eller prefixet ändras, så att taggen är urbockad om den kommer tillbaka. Urbockningen gäller bara rullistan: ett objekt med en urbockad tagg visas som vanligt.
- **Text som börjar med** är bokstavlig och utan hänsyn till versaler. `7.3` träffar också `7.30.0`, och `7.3.` missar ett objekt som har just `7.3`. Rich text, ja/nej-fält, personer och datum erbjuds inte, eftersom deras värde inte börjar med det som visas. Tal erbjuds och jämförs i den form Azure DevOps lämnar dem, så `14.10` i ett decimalfält läses som `14.1`.
- **Ifyllt eller tomt** räknar ett saknat fält och ett fält med bara blanksteg som tomt. Rich text erbjuds inte, eftersom ett sådant fält kan se tomt ut men ändå ha ett värde, och inte heller ja/nej-fält, som alltid har ett.
- Ett filterfält vars fält har försvunnit eller inte längre går att använda så lämnas bort, och hubben visar en varning i stället för att brädan går sönder. Inställningarna kräver ett nytt val, eller att filtret tas bort, innan något går att spara.
- Kan projektets taggar inte läsas lämnas filterfälten med taggprefix bort, och hubben säger varför. Brädan visas ändå, eftersom taggarna bara behövs för rullistan. I inställningarna syns felet vid filtret, och det går att spara med de urbockade taggarna kvar.

## Fält med formaterad text

Hubben visar fält av typen HTML som ren text, på kortet och i detaljpanelen. I detaljpanelen blir stycken och listpunkter egna rader, medan kortet visar texten sammanhängande. En länk blir bara sin text, och formatering och bilder visas inte. Ett fält som bara innehåller en bild räknas som tomt. Den som vill se fältet som det är öppnar work item:et.

Fältet läses av en enkel läsare som går igenom texten en gång och bara tar ut text. Inget träd byggs, eftersom en webbläsare kan behöva minuter eller krascha på vissa HTML-värden på några kilobyte, och det skulle drabba alla som öppnar hubben. Läsaren följer HTML:s regler där de spelar roll för vanlig text, men kan läsa trasig markup annorlunda än en webbläsare. Ett sådant fel ger fel ord, aldrig HTML i sidan.

Kan ett fälts värde inte skrivas ut alls visar fältet "Could not be read here. Open the work item to see it.", och resten av kortet och brädan står kvar.

## Text som kan vilseleda

Text från work items visas som den står, och det är ett medvetet val:

- Text som är dold med CSS i ett HTML-fält syns på brädan, eftersom bara texten läses och inte formateringen.
- Styrtecken för textriktning och osynliga tecken tas inte bort, så en text kan se ut att säga något annat än den gör, eller se tom ut. En rensning skulle också ändra text på högerställda språk, och den som kan ändra fältet kan ändå skriva vad som helst.
- Fritext ingår i kortets tillgängliga namn, så en titel kan låtsas ange en annan fas. Namnet går inte att göra helt säkert så länge titeln ingår i det.

## Långa värden

"Aktuellt läge" och "Väntar på" visas på högst två rader på kortet, och hela texten står i detaljpanelen. Titeln visas som den står, med sina radbrytningar, så en titel med många radbrytningar gör kortet högt.

En tavla där tusentals objekt har fält på hundratals kilobyte blir långsam att öppna, men felet stannar hos dem som öppnar just den tavlan.

## Gränser i inställningarna

Inställningsdokumentet kan skrivas av alla som kan öppna hubben, och varje besökares webbläsare läser det. Därför avvisas ett dokument som har mer än detta. Gränserna ligger långt över vad ett ärligt dokument innehåller, och över Azure DevOps egna gränser där sådana finns:

| Vad | Högst |
| --- | --- |
| Tecken i ett namn eller en text | 1 000 |
| Faser, och flikar | 2 048 |
| Fält i detaljpanelen | 1 024 |
| Bortvalda grupper | 20 000 |
| Filterfält | 100 |
| Urbockade taggar per filterfält | 20 000 |
| Poster i loggen | 500 |

Panelen sparar inget som hubben inte kan läsa tillbaka, och säger då varför. Fliknamn och avdelare kan skrivas hur långa som helst i panelen, men det syns först när man sparar.

Felmeddelanden upprepar inte det som står i dokumentet. Annars skulle den som skriver dokumentet kunna lägga sina ord i Waypoints mun, i ett fel som ser ut som Waypoints eget. Meddelandena säger därför att en typ saknas, eller hur många fält som är borta, utan att nämna dem. I panelen syns det vid varje val.

## Fält som inte går att använda

Om ett fält som inställningarna pekar på inte längre finns på objektets typ, eller är av en sort rollen inte kan använda, visar hubben brädan utan fältet och en varning, tills en Project Administrator har sparat om inställningarna.

## Installationsmål

Extensionen installeras bara i Azure DevOps Services (`Microsoft.VisualStudio.Services.Cloud`). Hubbens Content Security Policy skulle ändå blockera en lokal Azure DevOps Server.

## Efter att ett work item har ändrats

Hubben hämtar data när den öppnas. Ändrar någon ett work item i dialogen som knappen i detaljpanelen öppnar, syns ändringen på brädan först efter omladdning.

## Hubbens ikon i hög kontrast

Hubbens ikon i menyn är båten, som en enda mörk bild. Azure DevOps inverterar bilden i temat Dark men inte i temat High Contrast (Dark), som är i beta. Där är båten mörk på svart botten och syns knappt.

Namnet Waypoint syns bredvid ikonen när menyn är utfälld. I hopfälld meny visas bara ikonen, så där är raden svår att hitta i det temat.

Gränsen är ett val: båten behålls. Azure DevOps har ingen båt bland sina egna glyfer, och de är det enda ikonsättet som följer alla teman. Med en bild per tema blir High Contrast (Dark) rätt, men då blir förra temats bild kvar efter ett temabyte tills menyn ritas om.
