import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
export interface FolderPick {folderName:string;create:boolean;}
@Component({selector:'app-folder-picker',standalone:true,imports:[CommonModule,FormsModule,IonicModule,TranslateModule],templateUrl:'./folder-picker.component.html',styleUrls:['./folder-picker.component.scss']})
export class FolderPickerComponent implements OnChanges {
  @Input() open=false;
  @Input() folders:Array<{id?:string;name:string}>=[];
  @Input() initialTarget='__all__';
  @Output() openChange=new EventEmitter<boolean>();
  @Output() picked=new EventEmitter<FolderPick>();
  creating=false;query='';target='__all__';name='';
  ngOnChanges(changes:SimpleChanges):void {if(changes['open'] && this.open){this.creating=false;this.query=this.name='';this.target=this.initialTarget;}}
  get filteredFolders(){return this.folders.filter(folder=>folder.name.toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase()));}
  focus(event:Event):void {(event.target as HTMLElement).querySelector<HTMLInputElement>('[name="folderSearch"]')?.focus();}
  createFolder():void {this.creating=true;this.name='';setTimeout(()=>document.querySelector<HTMLInputElement>('ion-modal.folder-picker-modal [name="newFolderName"]')?.focus());}
  confirm():void {
    const folderName=this.creating?this.name.trim():this.target;
    if(!folderName || (this.creating && folderName.length>80))return;
    this.picked.emit({folderName,create:this.creating});
  }
}
