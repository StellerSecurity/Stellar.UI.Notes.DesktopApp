import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguagePickerComponent } from './language-picker.component';
import { APP_CATALOGS } from '../i18n';

describe('Searchable language picker', () => {
  let fixture: ComponentFixture<LanguagePickerComponent>, picker: LanguagePickerComponent;
  beforeEach(async () => {
    await TestBed.configureTestingModule({imports:[LanguagePickerComponent, TranslateModule.forRoot()]}).compileComponents();
    const translate=TestBed.inject(TranslateService); translate.setTranslation('en',APP_CATALOGS.en); translate.use('en');
    fixture=TestBed.createComponent(LanguagePickerComponent); picker=fixture.componentInstance; fixture.detectChanges();
  });
  it('searches native names, English names and accents without changing the preference while typing', () => {
    const emit=spyOn(picker.valueChange,'emit');
    for (const [query, code] of [['Danish','da'],['dansk','da'],['turkce','tr'],['espanol','es'],['bokmal','nb'],['Brazil','pt-BR'],['Swedish','sv'],['francais','fr'],['polski','pl'],['de','de']]) {
      picker.search(query); expect(picker.filtered.map(item=>item.code)).withContext(query).toContain(code);
    }
    expect(emit).not.toHaveBeenCalled();
    picker.search('unsupported-language'); expect(picker.filtered).toEqual([]);
  });
  it('supports keyboard selection and Escape cancellation', () => {
    const emit=spyOn(picker.valueChange,'emit');
    picker.show(new Event('click')); picker.search('dansk');
    picker.onKeydown(new KeyboardEvent('keydown',{key:'Enter'}));
    expect(emit).toHaveBeenCalledOnceWith('da'); expect(picker.opened).toBeFalse();
    emit.calls.reset(); picker.show(new Event('click'));
    picker.onKeydown(new KeyboardEvent('keydown',{key:'End'})); expect(picker.filtered[picker.activeIndex].code).toBe('pt-BR');
    picker.onKeydown(new KeyboardEvent('keydown',{key:'ArrowDown'})); expect(picker.activeIndex).toBe(0);
    picker.onKeydown(new KeyboardEvent('keydown',{key:'Escape'})); expect(picker.opened).toBeFalse(); expect(emit).not.toHaveBeenCalled();
  });
  it('keeps a clear native-language label and returns focus on dismissal', async () => {
    fixture.componentRef.setInput('value','tr'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').textContent).toContain('Türkçe');
    picker.dismissed();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(picker.trigger.nativeElement);
  });
});
