import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { DesktopUpdateService, UpdateStatusComponent } from './update-status.component';

describe('Automatic desktop update status',()=>{
  let original:any;
  beforeEach(()=>{original=(window as any).electronAPI;});
  afterEach(()=>{(window as any).electronAPI=original;TestBed.resetTestingModule();});
  it('stays hidden in browsers without a desktop bridge',()=>{
    (window as any).electronAPI=undefined;
    const service=new DesktopUpdateService(new NgZone({enableLongStackTrace:false}));
    let value:any;service.status$.subscribe(status=>value=status);
    expect(value.phase).toBe('idle');service.ngOnDestroy();
  });
  it('receives native progress outside Angular and ignores stale startup snapshots',async()=>{
    let deliver!:(status:any)=>void,resolve!:(status:any)=>void;const dispose=jasmine.createSpy();
    (window as any).electronAPI={onUpdateStatus:(callback:any)=>{deliver=callback;return dispose;},getUpdateStatus:()=>new Promise(done=>resolve=done)};
    const zone=new NgZone({enableLongStackTrace:false});const service=new DesktopUpdateService(zone);let value:any;
    service.status$.subscribe(status=>{value=status;if(status.phase!=='idle')expect(NgZone.isInAngularZone()).toBeTrue();});
    zone.runOutsideAngular(()=>deliver({phase:'downloading',percent:64.2,privateData:'must not persist'}));
    resolve({phase:'idle'});await Promise.resolve();
    expect(value).toEqual({phase:'downloading',percent:64});
    deliver({phase:'unexpected',percent:100});expect(value.phase).toBe('downloading');
    service.ngOnDestroy();expect(dispose).toHaveBeenCalled();deliver({phase:'error'});expect(value.phase).toBe('downloading');
  });
  it('renders download, verification, automatic restart and generic errors without install buttons',()=>{
    const status=new BehaviorSubject<any>({phase:'idle',percent:null});
    TestBed.configureTestingModule({imports:[UpdateStatusComponent,TranslateModule.forRoot()],providers:[{provide:DesktopUpdateService,useValue:{status$:status}}]});
    const fixture=TestBed.createComponent(UpdateStatusComponent);fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.update-status')).toBeNull();
    status.next({phase:'downloading',percent:64});fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('64');
    expect(fixture.nativeElement.textContent).toContain('64 %');
    status.next({phase:'verifying',percent:null});fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('updateStatusVerifying');
    status.next({phase:'installing',percent:null});fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('updateStatusRestartHint');
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();expect(fixture.nativeElement.querySelector('button')).toBeNull();
    status.next({phase:'error',percent:null});fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('updateStatusErrorHint');
    fixture.destroy();
  });
  it('keeps unknown download size indeterminate rather than displaying a false percentage',()=>{
    const status=new BehaviorSubject<any>({phase:'downloading',percent:null});
    TestBed.configureTestingModule({imports:[UpdateStatusComponent,TranslateModule.forRoot()],providers:[{provide:DesktopUpdateService,useValue:{status$:status}}]});
    const fixture=TestBed.createComponent(UpdateStatusComponent);fixture.detectChanges();
    const track=fixture.nativeElement.querySelector('[role="progressbar"]');
    expect(track.hasAttribute('aria-valuenow')).toBeFalse();expect(track.classList.contains('indeterminate')).toBeTrue();
    expect(fixture.nativeElement.querySelector('.percentage')).toBeNull();fixture.destroy();
  });
});
