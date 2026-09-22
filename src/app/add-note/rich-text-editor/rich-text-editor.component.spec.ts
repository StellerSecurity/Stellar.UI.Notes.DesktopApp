import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { QuillModule } from 'ngx-quill';

import en from '../../../assets/i18n/en.json';
import da from '../../../assets/i18n/da.json';
import de from '../../../assets/i18n/de.json';
import fr from '../../../assets/i18n/fr.json';
import se from '../../../assets/i18n/se.json';

import { RichTextEditorComponent } from './rich-text-editor.component';

describe('RichTextEditorComponent', () => {
  let component: RichTextEditorComponent;
  let fixture: ComponentFixture<RichTextEditorComponent>;

  beforeEach(waitForAsync(async () => {
    await TestBed.configureTestingModule({
      declarations: [ RichTextEditorComponent ],
      imports: [IonicModule.forRoot(), FormsModule, TranslateModule.forRoot(), QuillModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(RichTextEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  for (const [language, catalog] of Object.entries({ en, da, de, fr, se })) {
    it(`renders the ${language} note prompt without inserting it into note content`, async () => {
      const expected = (catalog as Record<string, string>)['enterYourNoteHere'];
      expect(expected).withContext('Every shipped language needs the editor prompt').toBeTruthy();
      const translate = TestBed.inject(TranslateService);
      translate.setTranslation(language, catalog);
      translate.use(language);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const editor: HTMLElement = fixture.nativeElement.querySelector('.ql-editor');
      expect(editor.getAttribute('data-placeholder')).toBe(expected);
      expect(editor.textContent?.trim()).toBe('');
      expect(component.quill.getText()).toBe('\n');
    });
  }

  it('uses a readable prompt while translations are missing', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const editor: HTMLElement = fixture.nativeElement.querySelector('.ql-editor');
    expect(editor.getAttribute('data-placeholder')).toBe('Enter your note here..');
    expect(editor.textContent?.trim()).toBe('');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
