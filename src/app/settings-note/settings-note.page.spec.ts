import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsNotePage } from './settings-note.page';

describe('SettingsNotePage', () => {
  let component: SettingsNotePage;
  let fixture: ComponentFixture<SettingsNotePage>;

  beforeEach(async(() => {
    fixture = TestBed.createComponent(SettingsNotePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
