import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { QuillModule } from 'ngx-quill';

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

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
