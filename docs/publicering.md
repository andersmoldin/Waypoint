# Publicering

Waypoint finns i två extensioner: den privata [`waypoint-dev`](#waypoint-dev) under publishern `andersmoldin-dev`, som publiceras vid varje merge, och den publika [`waypoint-board`](#waypoint-board) ("Waypoint") under publishern `andersmoldin`, som publiceras vid en tag och ägarens godkännande. Båda byggs av `vss-extension.json` plus sitt eget manifest (`vss-extension.dev.json` respektive `vss-extension.public.json`). De får inte sätta samma fält: `tfx` behåller det första värdet för fält som `id`, så ett manifest kan inte skriva över ett annat. Bara `files` läggs ihop. `scripts/verifyVsix.sh` kontrollerar den färdiga vsix-filen, både där den byggs och i publiceringsjobbet innan något credential finns: identitet, version, synlighet, att scopet är just `vso.work`, att sidorna är extensionens egna och har sidans Content Security Policy, och att paketet inte innehåller något annat.

Publisherna är två eftersom ett Trusted Publishing-credential begärs för en publisher, inte för en extension, och dev-flödet körs utan godkännande vid varje merge. Det flödet ska inte kunna nå den publika extensionen. Microsoft dokumenterar inte om credentialen är begränsad per extension, så designen utgår från att den inte är det.

Publiceringen är gemensam: `scripts/publishToMarketplace.sh`.

## `waypoint-dev`

Varje merge till `main` kör `.github/workflows/publish-dev.yml`. Det bygger en vsix med versionen `ÅÅÅÅ.M.<körningsnummer>` och publicerar den privata `waypoint-dev` ("Waypoint (dev)"), delad bara med organisationen `andersmoldin` (delningen är ett engångssteg för ägaren, se nedan). Ingen PAT eller annan hemlighet lagras: jobbet byter sitt GitHub OIDC-token mot ett Marketplace-credential som lever i 15 minuter.

Den första publika versionen är taggen `v2026.11.0`.

### Hur publiceringen går till

Publiceringsjobbet kör inga npm-paket, bara `curl`, `jq` och `unzip` från runnern och de två låsta GitHub-actionen som hämtar filerna. Det är där credentialen finns, och ett komprometterat paket skulle där kunna hämta fler credentials eller byta ut filen, också efter ett godkännande. `tfx` används bara för att bygga paketet, i jobbet före.

`scripts/publishToMarketplace.sh` gör två saker i ordning:

1. Laddar upp vsix-filen med `PUT` om extensionen finns och `POST` om Marketplace svarar 404. Svarar Marketplace något annat laddas inget upp.
2. Frågar Marketplace om valideringen var 20:e sekund, i högst 90 minuter. Credentialen byts ut var tionde minut under väntan.

Microsoft dokumenterar inget REST-API för Marketplace, så det här är härlett:

| Vad | Varifrån |
| --- | --- |
| Utbytet av GitHubs OIDC-token mot ett credential | `vsce` (`src/oidc.ts`) |
| Uppladdning och validering | `tfx` (`_lib/publish.js`) och `azure-devops-node-api`. Anropen är inspelade mot en stub och stämmer med `tfx` utom i `User-Agent` och `Connection` |

Ändrar Microsoft kontraktet blir körningen röd, aldrig en felaktig publicering: ett svar skriptet inte förstår räknas som att valideringen väntar, tills tiden går ut. Portalen på <https://marketplace.visualstudio.com/manage> är reserven: ladda ner vsix-filen från körningen och ladda upp den där.

Flödet delar inte. Ett Trusted Publishing-credential får bara ladda upp, uppdatera och läsa valideringsstatus; `tfx extension share` ger 403 ("Trusted Publishing credentials only support extension upload and update"). Delning gäller hela extensionen och alla dess versioner, så den görs en gång av ägaren (se nedan). Att credentialen får läsa delningen är inte bevisat, så flödet kontrollerar den inte.

Körningen blir grön när versionen är uppladdad och godkänd. Den blir röd om Marketplace avvisar versionen (felmeddelandet skrivs ut) eller om valideringen inte är klar efter 90 minuter.

**Första körningen efter bytet till `curl` och den nya publishern** är den första riktiga provningen av kontraktet, och den skapar extensionen. Blir den röd före uppladdningen är inget publicerat. Säger den `Could not read` med något annat än 404 har Marketplace svarat oväntat på en extension som inte finns. Ladda då upp den första versionen i portalen, så går nästa merge över till att uppdatera.

### Om en körning blir röd

Körningar som fallerar före uppladdningen, till exempel vid utbytet av token, har inte publicerat något. Då går de att köra om med **Re-run failed jobs** inom sju dagar, så länge vsix-filen finns kvar.

Körningar som fallerar efter uppladdningen kan ha lämnat versionen på Marketplace. En omkörning med samma version avvisas, så gör så här:

1. Läs versionen i körningens logg (`ÅÅÅÅ.M.<körningsnummer>`).
2. Kontrollera valideringen på <https://marketplace.visualstudio.com/manage>.
3. Om valideringen fortfarande väntar: vänta och gör om steg 2.
4. Om Marketplace avvisade versionen: rätta orsaken och merga. Nästa merge ger en ny version.

### Engångssteg som bara ägaren kan göra

Stegen 1 till 3 görs före merge av den PR som lägger till flödet, annars misslyckas den första körningen.

1. **GitHub-environment.** Skapa `waypoint-dev` under repots Settings → Environments, och sätt Deployment branches till Selected branches med bara `main`.

2. **Publisher och Trusted Publishing-policy.** Skapa publishern `andersmoldin-dev` på <https://marketplace.visualstudio.com/manage>. Öppna dess sida Trusted Publishing och lägg till en policy:

   | Fält        | Värde             |
   | ----------- | ----------------- |
   | Repo-ägare  | `andersmoldin`    |
   | Repo        | `Waypoint`        |
   | Workflow    | `publish-dev.yml` |
   | Environment | `waypoint-dev`    |

3. **Ta bort den gamla vägen.** Ta bort policyn för `publish-dev.yml` på publishern `andersmoldin`, och ta bort den gamla extensionen `andersmoldin.waypoint-dev` där. Annars är publisherna inte åtskilda.

4. **Obligatoriska kontroller på `main`.** Rulesetet "Skydda main" kräver `lint`, `test`, `build`, `browser` och skanningarna i `security.yml`, med kravet att branchen är uppdaterad mot `main`. En ny allvarlig sårbarhet i det som levereras stoppar då merge tills den är åtgärdad:

   ```sh
   ruleset_id="$(gh api repos/andersmoldin/Waypoint/rulesets --jq '.[] | select(.name == "Skydda main") | .id')"
   gh api "repos/andersmoldin/Waypoint/rulesets/${ruleset_id}" --jq '
     {name, target, enforcement, conditions, bypass_actors,
      rules: ([.rules[] | select(.type != "required_status_checks")] + [{type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: [
          "lint", "test", "build", "browser", "codeql (javascript-typescript)", "codeql (actions)", "semgrep", "npm-audit"
          | {context: ., integration_id: 15368}]}}])}' |
     gh api --method PUT "repos/andersmoldin/Waypoint/rulesets/${ruleset_id}" --input -
   ```

5. **Dela extensionen med `andersmoldin`.** Delningen gäller hela extensionen och alla versioner, så den görs en gång, efter den första publiceringen. Flödet gör den inte och kontrollerar den inte (se ovan). Enklast är Share på <https://marketplace.visualstudio.com/manage>. Med en PAT kontrollerar ägaren den så här:

   ```sh
   tfx extension show --publisher andersmoldin-dev --extension-id waypoint-dev --auth-type pat --token <PAT> --json | jq '.sharedWith'
   ```

   `andersmoldin` ska finnas i listan.

6. **Installera i testorgen, efter den första lyckade publiceringen.** Öppna Organization settings → Extensions → Shared i `dev.azure.com/andersmoldin`, välj Waypoint (dev) och installera. Senare versioner uppdateras automatiskt.

7. **Kontrollera hubben.** Öppna Boards i projektet `Waypoint-test` som admin och som Stakeholder. Hubben Waypoint ska synas där och visa fasbrädan med rutan om att den inte är inställd. Saknar Feature picklistfält visas bara rutan. Hubben kräver att Boards-tjänsten är påslagen i projektet.

## `waypoint-board`

En tag `vÅÅÅÅ.M.N` på `main` kör `.github/workflows/publish-public.yml`. Ingen PAT eller annan hemlighet lagras eller används.

Extensionens id (`id` i `vss-extension.public.json`) måste vara unikt i hela Marketplace, över alla publishers. Andra publishers har extensioner med id:t `waypoint`, och `andersmoldin.waypoint` avvisades därför med HTTP 400: "The extension 'waypoint' already exists in the Marketplace. Please use a different 'name' in the package.json file". Felet nämner `name` i `package.json`, men det är extensionens id som krockar, och det avvisades både med visningsnamnet "Waypoint" (v2026.11.0) och med "Waypoint Board" (v2026.11.1). Därför publiceras den som `andersmoldin.waypoint-board`. Med visningsnamnet "Waypoint Board" och id:t `waypoint-board` gick v2026.11.2 igenom. Visningsnamnet är nu "Waypoint" (`name` i `vss-extension.public.json`) med id:t `waypoint-board`. Den kombinationen är oprövad. Det är okänt om visningsnamnet också måste vara unikt i Marketplace; nästa release visar om det godtas.

1. **Grind.** Versionen läses ur tagen med `scripts/versionFromTag.ts`, och `scripts/releaseGate.sh` avbryter om något av detta inte stämmer:
   - Commiten finns på `main`.
   - Environmentet `marketplace` har en obligatorisk granskare. Annars skulle en tag ensam publicera.
   - Commiten har statusen `e2e-testorg`, grön och satt av `andersmoldin`.
   - `SECURITY_AUDIT.md` och `ACCESSIBILITY.md` finns. Listningen länkar till dem, och de kommer från granskningarna i [#2](https://github.com/andersmoldin/Waypoint/issues/2).
2. **Paket.** Vsix-filen byggs med tagens version via `tfx --override` och kontrolleras med `scripts/verifyVsix.sh`. Versionen finns ingen annanstans: `0.0.0` i manifestet är en platshållare. Filens SHA-256 skrivs på körningens sida.
3. **Godkännande.** Publiceringsjobbet väntar i environmentet `marketplace` tills ägaren godkänner. Efter godkännandet kontrolleras att filen har samma SHA-256 och klarar `scripts/verifyVsix.sh`, innan något credential hämtas.
4. **Publicering.** Jobbet laddar upp och väntar på valideringen på samma sätt som för `waypoint-dev`. Trusted Publishing-policyn gäller bara det här workflowet och environmentet, så utan environmentet går inget token att byta.

### Så släpper du en version

Versionen är `ÅÅÅÅ.M.N`, där N räknar releaser inom månaden från 0: `2026.11.0`, `2026.11.1`, `2026.12.0`. Inga inledande nollor.

1. Kontrollera att `publish-dev.yml` är grön för den commit på `main` som ska släppas. Testorgen måste köra just det bygget, så det är normalt senaste commiten.
2. Hämta commiten och installera: `git checkout <commit> && npm ci`. Arbetskopian måste vara ren.
3. Kör `npm run e2e`. En Chrome-profil utanför repot (`~/.cache/waypoint-e2e-profile`) öppnas. Logga in med en Stakeholder- eller Reader-användare i testorgen om det behövs. Testet av inställningspanelen öppnar en andra profil (`~/.cache/waypoint-e2e-administrator-profile`), eftersom bara en administratör ser kugghjulet. Logga in där med en Project Administrator. Det testet läser bara och sparar inget. Vid grönt visas Stakeholder- eller Reader-kontot, och du bekräftar att det är rätt typ av användare. Då sätts statusen `e2e-testorg` på commiten med din `gh`-inloggning.
4. Tagga och pusha: `git tag v2026.11.0 <commit> && git push origin v2026.11.0`.
5. Öppna körningen under Actions och godkänn den när den väntar på `marketplace`.

Säger testet att testorgen kör ett annat bygge har Marketplace inte hunnit uppdatera den installerade extensionen. Vänta och kör igen.

### Varför testet körs på ägarens dator

Specen ([#1](https://github.com/andersmoldin/Waypoint/issues/1)) säger att end-to-end-testet körs i release-jobbet. Det gör det inte, och avvikelsen är ett beslut:

- Hubbsidan i Azure DevOps kräver en inloggad webbsession. Den svarar 401 på samma PAT som REST-API:t accepterar, så testet kan inte logga in med en header.
- I CI skulle sessionen behöva sparas som en hemlighet. Det är en långlivad inloggning som kan läcka, vilket kedjan annars undviker helt, och det är obeprövat om Microsoft godtar den från GitHubs IP-adresser.
- En self-hosted runner avråder GitHub från i publika repon.

Kravet i sig ligger kvar: inget publiceras utan ett grönt test av just den commiten. Priset är ett kommando per release. Statusen är självrapporterad, men grinden räknar bara en status från ägaren. Testet gäller dev-bygget av commiten: den publika vsix-filen byggs för sig, så det är inte samma fil som har testats.

`npm ci` kör inga install-skript, eftersom `.npmrc` stänger av dem. Ägarens dator hör ändå till det som måste vara pålitligt. Logga inte in i testets webbläsare med det Microsoft-konto som äger publishern.

Vilket konto testet körs med står inte i repot, och en användare kan inte läsa sin egen åtkomstnivå. Därför bekräftar ägaren det i steg 3.

### Om en körning blir röd

- **Grinden eller paketet:** inget är publicerat. Rätta orsaken och kör **Re-run failed jobs**. Om det krävs en ny commit: släpp den med en ny tag.
- **Publiceringen, före uppladdningen** (till exempel utbytet av token): inget är publicerat. Kör om inom sju dagar, så länge vsix-filen finns kvar.
- **Publiceringen, efter uppladdningen:** versionen kan ligga på Marketplace, och en omkörning med samma version avvisas. Läs valideringens status på <https://marketplace.visualstudio.com/manage>. Väntar den fortfarande: vänta. Har Marketplace avvisat den: rätta orsaken och släpp med nästa N.

### Engångssteg som bara ägaren kan göra

Stegen görs före den första taggen. Grinden avbryter om granskaren saknas, så ett glömt steg 1 publicerar inget.

1. **GitHub-environment `marketplace`.** Ägaren som obligatorisk granskare, bara taggar `v*` får köra, self-review tillåten eftersom ägaren både taggar och godkänner, och administratörer kan inte gå förbi granskningen:

   ```sh
   owner_id="$(gh api users/andersmoldin --jq .id)"
   gh api --method PUT repos/andersmoldin/Waypoint/environments/marketplace --input - <<EOF
   {"reviewers":[{"type":"User","id":${owner_id}}],"prevent_self_review":false,"can_admins_bypass":false,
    "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
   EOF
   gh api --method POST repos/andersmoldin/Waypoint/environments/marketplace/deployment-branch-policies \
     -f name='v*' -f type=tag
   ```

2. **Trusted Publishing-policy.** Öppna <https://marketplace.visualstudio.com/manage>, publishern `andersmoldin`, sidan Trusted Publishing, och lägg till en policy:

   | Fält        | Värde                |
   | ----------- | -------------------- |
   | Repo-ägare  | `andersmoldin`       |
   | Repo        | `Waypoint`           |
   | Workflow    | `publish-public.yml` |
   | Environment | `marketplace`        |

3. **Skydda release-taggarna (krävs före den första taggen).** En tag startar release-flödet, så bara ägaren ska få skapa, flytta eller ta bort en:

   ```sh
   owner_role_id=5 # Repository admin, som bara ägaren har.
   gh api --method POST repos/andersmoldin/Waypoint/rulesets --input - <<EOF
   {"name":"Skydda release-taggar","target":"tag","enforcement":"active",
    "bypass_actors":[{"actor_id":${owner_role_id},"actor_type":"RepositoryRole","bypass_mode":"always"}],
    "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
    "rules":[{"type":"creation"},{"type":"deletion"},{"type":"update"},{"type":"non_fast_forward"}]}
   EOF
   ```

4. **Slå på privat sårbarhetsrapportering.** `SECURITY.md` skickar rapportörer dit:

   ```sh
   gh api --method PUT repos/andersmoldin/Waypoint/private-vulnerability-reporting
   ```

### Före den första releasen

- **Skärmbilderna:** kör `npm run screenshots` när hubbens utseende har ändrats och checka in resultatet. Skriptet renderar den riktiga hubben med påhittad data.
- **Öppen fråga:** om den första publika publiceringen kräver manuell granskning eller verifierad publisher avgörs vid första försöket. Avvisas den syns felet i körningen.

## Listningens material

| Vad                  | Var                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------- |
| Text                 | `README.md`                                                                            |
| Skärmbilder          | `images/screenshots/`, genereras med `npm run screenshots`                             |
| Ikoner               | `images/icons/`, genereras med `npm run icons` från SVG:erna i `assets/icons/`         |
| Licens och integritet | `LICENSE`, `PRIVACY.md`                                                                |
| Säkerhet             | `SECURITY.md` och `SECURITY_AUDIT.md`                                                  |
| Tillgänglighet       | `ACCESSIBILITY.md`                                                                     |

Båda skripten använder Chrome via Playwright. PNG-filerna checkas in, så bygget behöver inget bildverktyg.

Ikonerna är två. Marketplace-ikonen (`icons.default`) finns i 128 och 256 px, i en ljus och en mörk variant. Hubbens menyikon (`icon` i manifestet) är ritad på ett 16 px-rutnät i det ljusa temats glyffärg och finns i 32 px, så att den är skarp på Retina i de 16 px Boards-menyn visar den i.

Menyikonen är en enda mörk bild, angiven som en sträng. Azure DevOps inverterar en sådan ikon med temats CSS i det mörka temat, och det gäller direkt vid temabyte. Med `icon.light` och `icon.dark` väljer menyn variant bara när den ritas, och den ritas inte om vid temabyte, så förra temats variant blir kvar. Det är mätt i menyn i ett publikt Azure DevOps-projekt (M280). Inverteringen är inte dokumenterad av Microsoft. Vad den inte täcker står i [Kända gränser](kanda-granser.md#hubbens-ikon-i-hög-kontrast).

En `overview.md` som genereras från README:n var ett alternativ. Nu är README:n själv listningens text: en källa och inget genereringssteg, så texterna kan inte glida isär. Därför är bilderna i README:n relativa (de följer med i paketet) och länkarna absoluta (Marketplace skriver inte om dem).

End-to-end-testet förväntar sig att testorgen har sina påhittade objekt kvar, bland annat `RPA_002.Allvert.Kreditnotor` i fasen `Idéfas`.

## Om en skadlig version har släppts

Azure DevOps uppdaterar alla installationer automatiskt, och att avpublicera en version skyddar bara nya kunder. Gör så här, i den här ordningen:

1. Ta bort Trusted Publishing-policyn för `publish-public.yml` på publishern `andersmoldin`, så att inget mer kan publiceras den vägen.
2. Avpublicera `waypoint-board` på <https://marketplace.visualstudio.com/manage>, och kontakta Microsofts support: borttagning av säkerhetsskäl går via dem, och publisher-avtalet kräver att säkerhetshändelser rapporteras så snart som möjligt.
3. Ta reda på hur versionen kom ut, och byt det som kan ha läckt.
4. Släpp en rättad version med högre nummer, från en commit du litar på.
5. Publicera en GitHub Security Advisory som säger vilka versioner som berörs och vad administratörer ska kontrollera. Under Project settings → Service hooks ska de leta efter prenumerationer de inte känner igen, eftersom `vso.work` enligt Microsofts dokumentation täcker service hooks.

## Reserv: Entra workload identity federation

Reserven används bara om Marketplace avvisar credentialen från Trusted Publishing. Då ersätts de två `curl`-anropen i funktionen `fetch_credential` i `scripts/publishToMarketplace.sh`, och resten av flödet är oförändrat. PAT används aldrig. Använd en app registration per publisher, inte en för båda: en gemensam skulle ge dev-flödet samma identitet som den publika extensionen, och dess token gäller hela Azure DevOps, inte bara Marketplace.

1. Skapa en app registration i Entra per publisher, var och en med ett federated credential för issuern `https://token.actions.githubusercontent.com`, subject `repo:andersmoldin/Waypoint:environment:waypoint-dev` respektive `repo:andersmoldin/Waypoint:environment:marketplace`, och audience `api://AzureADTokenExchange`.

2. Lägg respektive apps klient-id och tenant-id som variablerna `ENTRA_CLIENT_ID` och `ENTRA_TENANT_ID` i sitt environment. De är inte hemligheter.

3. Byt innehållet i `fetch_credential` mot det här, med variablerna satta under stegets `env:` i båda workflowen. GitHub-tokenets audience ändras också:

   ```sh
   github_token="$(curl --silent --show-error --fail-with-body --config - \
     "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=api%3A%2F%2FAzureADTokenExchange" \
     <<< "header = \"Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}\"" | jq --exit-status --raw-output .value)"
   echo "::add-mask::${github_token}"

   credential="$(curl --silent --show-error --fail-with-body --config - \
     "https://login.microsoftonline.com/${ENTRA_TENANT_ID}/oauth2/v2.0/token" \
     --data-urlencode "client_id=${ENTRA_CLIENT_ID}" \
     --data-urlencode "grant_type=client_credentials" \
     --data-urlencode "scope=499b84ac-1321-427f-aa17-267ca6975798/.default" \
     --data-urlencode "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
     <<< "data-urlencode = \"client_assertion=${github_token}\"" | jq --exit-status --raw-output .access_token)"
   use_credential "${credential}"
   ```

4. Hämta varje service principals identitets-id genom att logga in som den och anropa `https://app.vssps.visualstudio.com/_apis/profile/profiles/me` med Entra-tokenet. Svarets `id` är det som behövs.

5. Öppna respektive publisher på <https://marketplace.visualstudio.com/manage>, välj Members → Add, ange id:t och välj rollen Contributor.

Om steg 4 kräver att service principalen läggs till i en organisation, och om organisationen då måste vara kopplad till en Entra-tenant, är obekräftat. Det är en öppen osäkerhet.
