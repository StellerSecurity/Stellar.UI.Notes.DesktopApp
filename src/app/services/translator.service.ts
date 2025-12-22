import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { TranslateService } from "@ngx-translate/core";
import { map } from "rxjs";
import * as EnLangTranslations from "src/assets/i18n/en.json";
import * as DaLangTranslations from "src/assets/i18n/da.json";
import * as DeLangTranslations from "src/assets/i18n/de.json";

@Injectable({
  providedIn: "root",
})
export class TranslatorService {
  hostName: string = "";
  language: string = "en";
  allTranslations: any;

  constructor(private http: HttpClient, private translate: TranslateService) {
    this.language = this.translate.getBrowserLang() || "en";
    this.loadTranslationsFromJsonFile();
  }

  loadTranslationsFromJsonFile(): void {
    this.translate.addLangs(["en", "de", "da", "se"]);

    if (this.hostName.includes(".dk")) {
      this.allTranslations = DaLangTranslations;
    } else if (this.hostName.includes(".de")) {
      this.allTranslations = DeLangTranslations;
    } else {
      this.allTranslations = EnLangTranslations;
    }
    this.translate.setTranslation(this.language, this.allTranslations);
    this.translate.setDefaultLang(this.language);
    this.translate.use(this.language);
  }

  loadTranslations(data: any) {
    this.translate.addLangs(["en", "de", "da", "se"]);

    this.translate.setDefaultLang(this.language);
    this.translate.use(this.language);

    return this.http.get(`${data}${this.language}.json`).pipe(
      map((translations: any) => {
        this.allTranslations = translations;
        this.translate.setTranslation(this.language, translations);
        return translations; // Return the loaded translations
      })
    );
  }
}
